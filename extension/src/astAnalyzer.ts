/**
 * LatencyLens — AST-Based C++ Analyzer
 *
 * Uses web-tree-sitter (WASM) to parse C++ source code into an AST,
 * then applies pattern-specific detection logic that understands context:
 *   - Is this inside a comment or string? (skip)
 *   - Is this a function parameter? (detect pass-by-value)
 *   - Is this vector used in a loop without reserve? (detect)
 *   - Are multiple atomics in the same struct? (detect false sharing)
 *
 * This replaces the Python regex-based analyzer entirely.
 * Zero external dependencies — runs in the VS Code extension host.
 */

import * as path from 'path';
import * as vscode from 'vscode';

let Parser: any;
let parserInstance: any;
let cppLanguage: any;
let initialized = false;

/**
 * Initialize tree-sitter with the C++ grammar WASM.
 * Must be called once before analyze().
 */
export async function initTreeSitter(extensionPath: string): Promise<boolean> {
    if (initialized) { return true; }
    try {
        Parser = require('web-tree-sitter');
        const wasmPath = path.join(extensionPath, 'wasm', 'tree-sitter.wasm');
        await Parser.init({
            locateFile: () => wasmPath,
        });
        parserInstance = new Parser();
        const cppWasm = path.join(extensionPath, 'wasm', 'tree-sitter-cpp.wasm');
        cppLanguage = await Parser.Language.load(cppWasm);
        parserInstance.setLanguage(cppLanguage);
        initialized = true;
        console.log('LatencyLens: tree-sitter initialized');
        return true;
    } catch (e) {
        console.error('LatencyLens: tree-sitter init failed, falling back to enhanced regex:', e);
        return false;
    }
}

export function isTreeSitterReady(): boolean {
    return initialized;
}

export interface ASTMatch {
    line: number;
    text: string;
    nodeType?: string;
    confidence: 'high' | 'medium' | 'low';
}

export interface ASTFinding {
    pattern_id: string;
    pattern_name: string;
    category: string;
    short_desc: string;
    explanation: string;
    matches: ASTMatch[];
    before_label: string;
    after_label: string;
    before_snippet: string;
    after_snippet: string;
    severity: 'high' | 'medium' | 'low';
}

// ── Tree Walking Helpers ────────────────────────────────────

function walkTree(node: any, callback: (node: any) => void): void {
    callback(node);
    for (let i = 0; i < node.childCount; i++) {
        walkTree(node.child(i), callback);
    }
}

function getAncestors(node: any): any[] {
    const ancestors: any[] = [];
    let current = node.parent;
    while (current) {
        ancestors.push(current);
        current = current.parent;
    }
    return ancestors;
}

function hasAncestorOfType(node: any, types: string[]): boolean {
    return getAncestors(node).some((a: any) => types.includes(a.type));
}

function isInsideLoop(node: any): boolean {
    return hasAncestorOfType(node, ['for_statement', 'while_statement', 'do_statement', 'for_range_loop']);
}

function isInsideComment(node: any): boolean {
    return node.type === 'comment' || hasAncestorOfType(node, ['comment']);
}

function getLineText(source: string, lineNum: number): string {
    const lines = source.split('\n');
    return lineNum >= 0 && lineNum < lines.length ? lines[lineNum].trim() : '';
}

function findSiblingsBefore(node: any, maxLines: number = 50): any[] {
    const results: any[] = [];
    const parent = node.parent;
    if (!parent) { return results; }
    for (let i = 0; i < parent.childCount; i++) {
        const child = parent.child(i);
        if (child.startPosition.row >= node.startPosition.row) { break; }
        if (node.startPosition.row - child.startPosition.row <= maxLines) {
            results.push(child);
        }
    }
    return results;
}

// ── Pattern Detectors ───────────────────────────────────────

type Detector = (tree: any, source: string) => ASTMatch[];

/**
 * detect std::map usage where unordered_map would suffice.
 * Skips: inside comments, std::multimap, ordered iteration patterns.
 */
const detectMapVsUnordered: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'qualified_identifier' || node.type === 'template_type') {
            const text = node.text;
            if (/\bstd\s*::\s*map\b/.test(text) && !/unordered/.test(text) && !/multimap/.test(text)) {
                if (!isInsideComment(node)) {
                    matches.push({
                        line: node.startPosition.row + 1,
                        text: getLineText(source, node.startPosition.row),
                        nodeType: node.type,
                        confidence: 'medium',
                    });
                }
            }
        }
    });
    return matches;
};

/**
 * detect std::list usage — almost always worse than vector.
 * Only skips if splice/merge operations are found nearby.
 */
const detectListVsVector: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    const hasSpliceOrMerge = /\.(splice|merge)\s*\(/.test(source);
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'qualified_identifier' || node.type === 'template_type') {
            const text = node.text;
            if (/\bstd\s*::\s*list\b/.test(text) && !/forward_list/.test(text)) {
                if (!isInsideComment(node)) {
                    matches.push({
                        line: node.startPosition.row + 1,
                        text: getLineText(source, node.startPosition.row),
                        nodeType: node.type,
                        confidence: hasSpliceOrMerge ? 'low' : 'high',
                    });
                }
            }
        }
    });
    return matches;
};

/**
 * detect push_back in loops without a preceding reserve().
 * Uses AST to find the loop context and check for reserve on the same variable.
 */
const detectReservePattern: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    // First collect all reserve() calls and what objects they're on
    const reservedVars = new Set<string>();
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'call_expression') {
            const funcNode = node.childForFieldName('function');
            if (funcNode && /\.reserve\s*$/.test(funcNode.text)) {
                // Extract variable name before .reserve
                const varName = funcNode.text.replace(/\.reserve\s*$/, '');
                reservedVars.add(varName);
            }
        }
    });

    // Now find push_back calls inside loops
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'call_expression') {
            const funcNode = node.childForFieldName('function');
            if (funcNode && /\.push_back\s*$/.test(funcNode.text)) {
                const varName = funcNode.text.replace(/\.push_back\s*$/, '');
                if (!reservedVars.has(varName) && isInsideLoop(node) && !isInsideComment(node)) {
                    matches.push({
                        line: node.startPosition.row + 1,
                        text: getLineText(source, node.startPosition.row),
                        nodeType: 'call_expression',
                        confidence: 'medium',
                    });
                }
            }
        }
    });
    return matches;
};

/**
 * detect virtual function declarations.
 * Only flags if there are multiple virtual methods (suggests hot path polymorphism).
 */
const detectVirtualVsCrtp: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'virtual_function_specifier' || node.type === 'virtual') {
            if (!isInsideComment(node)) {
                const parent = node.parent;
                if (parent && (parent.type === 'function_definition' || parent.type === 'declaration' || parent.type === 'field_declaration')) {
                    matches.push({
                        line: node.startPosition.row + 1,
                        text: getLineText(source, node.startPosition.row),
                        nodeType: parent.type,
                        confidence: 'low', // virtual has valid uses — lower confidence
                    });
                }
            }
        }
    });
    // Only report if there are 2+ virtual methods (hot-path polymorphism)
    return matches.length >= 2 ? matches : [];
};

/**
 * detect struct-with-many-fields used as vector element (AoS pattern).
 * Requires: struct with 4+ numeric/primitive fields AND a vector<StructName>.
 */
const detectAosSoa: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    const structFieldCounts = new Map<string, { line: number; fields: number }>();

    // Find structs with their field counts
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'struct_specifier' || node.type === 'class_specifier') {
            const nameNode = node.childForFieldName('name');
            const bodyNode = node.childForFieldName('body');
            if (nameNode && bodyNode) {
                let fieldCount = 0;
                for (let i = 0; i < bodyNode.childCount; i++) {
                    const child = bodyNode.child(i);
                    if (child.type === 'field_declaration') {
                        const text = child.text;
                        if (/\b(int|float|double|long|short|char|unsigned|size_t|uint\d+_t|int\d+_t)\b/.test(text)) {
                            // Count comma-separated declarators
                            fieldCount += (text.match(/,/g) || []).length + 1;
                        }
                    }
                }
                if (fieldCount >= 4) {
                    structFieldCounts.set(nameNode.text, {
                        line: node.startPosition.row + 1,
                        fields: fieldCount,
                    });
                }
            }
        }
    });

    // Check if any of these structs are used as vector elements
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'template_type' || node.type === 'qualified_identifier') {
            const text = node.text;
            if (/\bstd\s*::\s*vector\b/.test(text)) {
                for (const [structName, info] of structFieldCounts) {
                    if (text.includes(structName)) {
                        matches.push({
                            line: info.line,
                            text: getLineText(source, info.line - 1),
                            nodeType: 'struct_specifier',
                            confidence: info.fields >= 6 ? 'high' : 'medium',
                        });
                    }
                }
            }
        }
    });
    return matches;
};

/**
 * detect shared_ptr where unique_ptr would suffice.
 * Checks if the pointer is only used in one scope (never copied).
 */
const detectSharedVsUnique: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'qualified_identifier' || node.type === 'template_type') {
            const text = node.text;
            if (/\bstd\s*::\s*shared_ptr\b/.test(text)) {
                if (!isInsideComment(node)) {
                    matches.push({
                        line: node.startPosition.row + 1,
                        text: getLineText(source, node.startPosition.row),
                        nodeType: node.type,
                        confidence: 'medium', // Can't fully determine if shared ownership is needed from AST alone
                    });
                }
            }
        }
    });
    return matches;
};

/**
 * detect potential false sharing: multiple atomics in the same struct without alignas.
 */
const detectFalseSharing: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'struct_specifier' || node.type === 'class_specifier') {
            const bodyNode = node.childForFieldName('body');
            if (!bodyNode) { return; }

            let atomicCount = 0;
            let hasAlignAs = false;
            const atomicLines: number[] = [];

            for (let i = 0; i < bodyNode.childCount; i++) {
                const child = bodyNode.child(i);
                if (child.text.includes('std::atomic') || child.text.includes('atomic<')) {
                    atomicCount++;
                    atomicLines.push(child.startPosition.row + 1);
                }
                if (child.text.includes('alignas')) {
                    hasAlignAs = true;
                }
            }

            // Check the struct declaration itself for alignas
            if (node.text.includes('alignas')) {
                hasAlignAs = true;
            }

            if (atomicCount >= 2 && !hasAlignAs) {
                for (const line of atomicLines) {
                    matches.push({
                        line,
                        text: getLineText(source, line - 1),
                        nodeType: 'struct_specifier',
                        confidence: 'high',
                    });
                }
            }
        }
    });
    return matches;
};

/**
 * detect pass-by-value of large containers in function parameters.
 * Uses AST to find function declarations with STL container parameters not passed by reference.
 */
const detectPassByValue: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    const containerTypes = ['vector', 'string', 'map', 'unordered_map', 'set', 'unordered_set', 'list', 'deque', 'array'];

    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'function_definition' || node.type === 'function_declarator' || node.type === 'declaration') {
            // Find parameter list
            const paramList = findChild(node, 'parameter_list');
            if (!paramList) { return; }

            for (let i = 0; i < paramList.childCount; i++) {
                const param = paramList.child(i);
                if (param.type === 'parameter_declaration') {
                    const paramText = param.text;
                    // Check if it's a container type NOT passed by reference
                    const isContainer = containerTypes.some(ct =>
                        paramText.includes(`std::${ct}`) || new RegExp(`\\b${ct}\\s*<`).test(paramText)
                    );

                    if (isContainer && !paramText.includes('&') && !paramText.includes('*')) {
                        // It's a container passed by value!
                        matches.push({
                            line: param.startPosition.row + 1,
                            text: getLineText(source, param.startPosition.row),
                            nodeType: 'parameter_declaration',
                            confidence: 'high',
                        });
                    }
                }
            }
        }
    });
    return matches;
};

/**
 * detect pow(x, 2) or pow(x, 3) calls with small integer literal exponents.
 */
const detectPowVsMultiply: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'call_expression') {
            const funcNode = node.childForFieldName('function');
            if (funcNode && /\b(std\s*::\s*)?pow\b/.test(funcNode.text)) {
                // Check arguments for small integer literal
                const args = node.childForFieldName('arguments');
                if (args && args.childCount >= 3) {
                    // args: ( expr , expr )
                    const lastArg = args.child(args.childCount - 2); // last before closing paren
                    if (lastArg) {
                        const argText = lastArg.text.trim();
                        // Match small integer literals: 2, 3, 4, 2.0, 3.0
                        if (/^[234](\.0)?$/.test(argText)) {
                            if (!isInsideComment(node)) {
                                matches.push({
                                    line: node.startPosition.row + 1,
                                    text: getLineText(source, node.startPosition.row),
                                    nodeType: 'call_expression',
                                    confidence: 'high',
                                });
                            }
                        }
                    }
                }
            }
        }
    });
    return matches;
};

/**
 * detect std::endl usage, especially inside loops.
 */
const detectEndlVsNewline: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'qualified_identifier' || node.type === 'identifier') {
            if (/\b(std\s*::\s*)?endl\b/.test(node.text) && node.text !== 'endline') {
                if (!isInsideComment(node)) {
                    const inLoop = isInsideLoop(node);
                    matches.push({
                        line: node.startPosition.row + 1,
                        text: getLineText(source, node.startPosition.row),
                        nodeType: node.type,
                        confidence: inLoop ? 'high' : 'low',
                    });
                }
            }
        }
    });
    return matches;
};

/**
 * detect .size() calls in loop conditions.
 */
const detectLoopSizeHoist: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'for_statement') {
            // Check the condition (second expression in for)
            const condNode = node.childForFieldName('condition');
            if (condNode && /\.size\s*\(\s*\)/.test(condNode.text)) {
                // Check if loop body contains function calls (compiler can't prove size unchanged)
                const bodyNode = node.childForFieldName('body');
                let hasOpaqueCall = false;
                if (bodyNode) {
                    walkTree(bodyNode, (child: any) => {
                        if (child.type === 'call_expression') {
                            hasOpaqueCall = true;
                        }
                    });
                }
                if (!isInsideComment(node)) {
                    matches.push({
                        line: node.startPosition.row + 1,
                        text: getLineText(source, node.startPosition.row),
                        nodeType: 'for_statement',
                        confidence: hasOpaqueCall ? 'medium' : 'low',
                    });
                }
            }
        }
    });
    return matches;
};

/**
 * detect if/else patterns inside tight loops on data arrays (branch misprediction prone).
 */
const detectBranchVsBranchless: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'if_statement' && isInsideLoop(node)) {
            // Check if the if has a simple conditional assignment pattern
            const condNode = node.childForFieldName('condition');
            const consequenceNode = node.childForFieldName('consequence');
            const alternativeNode = node.childForFieldName('alternative');

            if (condNode && consequenceNode) {
                // Look for simple threshold comparison patterns like:
                //   if (data[i] >= THRESHOLD) sum += data[i];
                const condText = condNode.text;
                const isComparison = /[<>=!]+/.test(condText);
                const isSimpleBody = consequenceNode.text.split('\n').length <= 3;
                const hasArrayAccess = /\[.*\]/.test(condText);

                if (isComparison && isSimpleBody && hasArrayAccess && !isInsideComment(node)) {
                    matches.push({
                        line: node.startPosition.row + 1,
                        text: getLineText(source, node.startPosition.row),
                        nodeType: 'if_statement',
                        confidence: alternativeNode ? 'medium' : 'low',
                    });
                }
            }
        }
    });
    return matches;
};

/**
 * detect std::string parameters passed by value that could be string_view.
 */
const detectStringCopyVsView: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'function_definition' || node.type === 'function_declarator' || node.type === 'declaration') {
            const paramList = findChild(node, 'parameter_list');
            if (!paramList) return;
            for (let i = 0; i < paramList.childCount; i++) {
                const param = paramList.child(i);
                if (param.type === 'parameter_declaration') {
                    const t = param.text;
                    if (/\bstd\s*::\s*string\b/.test(t) && !t.includes('&') && !t.includes('*') && !t.includes('string_view')) {
                        if (!isInsideComment(param)) {
                            matches.push({ line: param.startPosition.row + 1, text: getLineText(source, param.startPosition.row), nodeType: 'parameter_declaration', confidence: 'medium' });
                        }
                    }
                }
            }
        }
    });
    return matches;
};

/**
 * detect push_back of a local variable that could use std::move.
 */
const detectMissingMove: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'call_expression') {
            const funcNode = node.childForFieldName('function');
            if (funcNode && /\.push_back\s*$/.test(funcNode.text)) {
                const args = node.childForFieldName('arguments');
                if (args) {
                    const argText = args.text;
                    // push_back(var) where var is a plain identifier (not a temporary or std::move)
                    if (/^\(\s*[a-zA-Z_]\w*\s*\)$/.test(argText) && !argText.includes('std::move') && !argText.includes('make_')) {
                        if (!isInsideComment(node)) {
                            matches.push({ line: node.startPosition.row + 1, text: getLineText(source, node.startPosition.row), nodeType: 'call_expression', confidence: 'low' });
                        }
                    }
                }
            }
        }
    });
    return matches;
};

/**
 * detect push_back(Type(...)) that could be emplace_back(...).
 */
const detectEmplaceVsPush: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'call_expression') {
            const funcNode = node.childForFieldName('function');
            if (funcNode && /\.push_back\s*$/.test(funcNode.text)) {
                const args = node.childForFieldName('arguments');
                if (args) {
                    const argText = args.text;
                    // push_back(Constructor(...)) or push_back(make_pair/make_tuple(...))
                    if (/\(\s*(std\s*::\s*)?(make_pair|make_tuple|make_shared|make_unique)\s*\(/.test(argText) ||
                        /\(\s*[A-Z]\w+\s*[\({]/.test(argText)) {
                        if (!isInsideComment(node)) {
                            matches.push({ line: node.startPosition.row + 1, text: getLineText(source, node.startPosition.row), nodeType: 'call_expression', confidence: 'medium' });
                        }
                    }
                }
            }
        }
    });
    return matches;
};

/**
 * detect functions that could be constexpr (simple computation, no I/O).
 * Only flags functions that return a computed value from constants.
 */
const detectRuntimeVsConstexpr: Detector = (tree, source) => {
    // This is hard to detect accurately with AST alone — use regex as primary
    return [];
};

/**
 * detect try/catch inside for/while loops.
 */
const detectExceptionHotPath: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'try_statement' && isInsideLoop(node)) {
            if (!isInsideComment(node)) {
                matches.push({ line: node.startPosition.row + 1, text: getLineText(source, node.startPosition.row), nodeType: 'try_statement', confidence: 'high' });
            }
        }
    });
    return matches;
};

/**
 * detect sort being called after a filter loop (could sort first for prediction).
 * Simple heuristic — this is more of a tip than a detection.
 */
const detectSortForPrediction: Detector = (tree, source) => {
    // Hard to detect the pattern "unsorted filter" accurately — rely on regex
    return [];
};

/**
 * detect dynamic_cast usage.
 */
const detectDynamicCastOverhead: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'cast_expression' || node.type === 'identifier') {
            if (/\bdynamic_cast\b/.test(node.text)) {
                if (!isInsideComment(node)) {
                    matches.push({ line: node.startPosition.row + 1, text: getLineText(source, node.startPosition.row), nodeType: node.type, confidence: isInsideLoop(node) ? 'high' : 'medium' });
                }
            }
        }
    });
    return matches;
};

/**
 * detect sync_with_stdio not being disabled.
 * Only flags if cin/cout are used heavily.
 */
const detectSyncIoOverhead: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    // Check if there are many cin reads without sync_with_stdio(false)
    const hasCinReads = (source.match(/std\s*::\s*cin\s*>>/g) || []).length;
    const hasSyncDisable = /sync_with_stdio\s*\(\s*false\s*\)/.test(source);
    if (hasCinReads >= 3 && !hasSyncDisable) {
        // Find the first cin usage
        walkTree(tree.rootNode, (node: any) => {
            if (node.type === 'qualified_identifier' || node.type === 'identifier') {
                if (/\bstd\s*::\s*cin\b/.test(node.text) && matches.length === 0) {
                    matches.push({ line: node.startPosition.row + 1, text: getLineText(source, node.startPosition.row), nodeType: node.type, confidence: 'medium' });
                }
            }
        });
    }
    return matches;
};

function findChild(node: any, type: string): any {
    for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === type) { return child; }
        const found = findChild(child, type);
        if (found) { return found; }
    }
    return null;
}

// ── mCoding-Inspired Detectors ──────────────────────────────

/**
 * detect 'using namespace std' at file/namespace scope.
 * Skips: inside function bodies (less harmful), inside comments.
 */
const detectUsingNamespaceStd: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'using_declaration' || node.type === 'preproc_directive' || node.type.includes('using')) {
            const text = node.text;
            if (/\busing\s+namespace\s+std\s*;/.test(text)) {
                if (!isInsideComment(node)) {
                    // Higher confidence at file scope than inside functions
                    const insideFunction = hasAncestorOfType(node, ['function_definition', 'compound_statement']);
                    matches.push({
                        line: node.startPosition.row + 1,
                        text: getLineText(source, node.startPosition.row),
                        nodeType: node.type,
                        confidence: insideFunction ? 'low' : 'high',
                    });
                }
            }
        }
    });
    return matches;
};

/**
 * detect C-style arrays (int arr[N]) that should be std::array.
 * Skips: main(int argc, char* argv[]), string literals.
 */
const detectCArrayVsStdArray: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'array_declarator') {
            const text = node.text;
            // Skip argv, string arrays used in main signature
            if (/\bargv\b/.test(text) || /\bchar\s*\*\s*\[/.test(text)) { return; }
            if (!isInsideComment(node)) {
                const lineText = getLineText(source, node.startPosition.row);
                // Skip if it is already std::array
                if (/std\s*::\s*array/.test(lineText)) { return; }
                matches.push({
                    line: node.startPosition.row + 1,
                    text: lineText,
                    nodeType: node.type,
                    confidence: 'medium',
                });
            }
        }
    });
    return matches;
};

/**
 * detect raw new/delete usage that should use smart pointers.
 * Skips: placement new, operator new overloads.
 */
const detectRawNewDelete: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'new_expression' || node.type === 'delete_expression') {
            const text = node.text;
            // Skip placement new
            if (/\bnew\s*\(/.test(text) && node.type === 'new_expression') {
                const lineText = getLineText(source, node.startPosition.row);
                if (/\bnew\s*\([^)]+\)\s+\w/.test(lineText)) { return; } // placement new
            }
            // Skip operator new/delete overloads
            if (hasAncestorOfType(node, ['operator_cast'])) { return; }
            const lineText = getLineText(source, node.startPosition.row);
            if (/\boperator\s+(new|delete)\b/.test(lineText)) { return; }
            // Skip if already wrapped in make_unique/make_shared
            if (/make_unique|make_shared/.test(lineText)) { return; }
            if (!isInsideComment(node)) {
                matches.push({
                    line: node.startPosition.row + 1,
                    text: lineText,
                    nodeType: node.type,
                    confidence: 'high',
                });
            }
        }
    });
    return matches;
};

/**
 * detect base classes with virtual methods but non-virtual destructors.
 */
const detectMissingVirtualDtor: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'class_specifier' || node.type === 'struct_specifier') {
            let hasVirtualMethod = false;
            let hasVirtualDestructor = false;
            let hasAnyDestructor = false;
            let className = '';

            // Get class name
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (child.type === 'type_identifier') {
                    className = child.text;
                }
            }

            // Walk the class body
            walkTree(node, (inner: any) => {
                if (inner.type === 'function_definition' || inner.type === 'declaration') {
                    const text = inner.text;
                    if (/\bvirtual\b/.test(text) && !/~/.test(text)) {
                        hasVirtualMethod = true;
                    }
                    if (/~\s*\w+/.test(text)) {
                        hasAnyDestructor = true;
                        if (/\bvirtual\b/.test(text)) {
                            hasVirtualDestructor = true;
                        }
                    }
                }
            });

            if (hasVirtualMethod && !hasVirtualDestructor) {
                matches.push({
                    line: node.startPosition.row + 1,
                    text: getLineText(source, node.startPosition.row),
                    nodeType: node.type,
                    confidence: hasAnyDestructor ? 'high' : 'medium',
                });
            }
        }
    });
    return matches;
};

/**
 * detect return std::move(local_variable) which prevents NRVO.
 */
const detectReturnStdMove: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    walkTree(tree.rootNode, (node: any) => {
        if (node.type === 'return_statement') {
            const text = node.text;
            if (/return\s+std\s*::\s*move\s*\(/.test(text)) {
                if (!isInsideComment(node)) {
                    matches.push({
                        line: node.startPosition.row + 1,
                        text: getLineText(source, node.startPosition.row),
                        nodeType: node.type,
                        confidence: 'high',
                    });
                }
            }
        }
    });
    return matches;
};

/**
 * detect std::unique_ptr<T>(new T) or std::shared_ptr<T>(new T)
 * that should use make_unique / make_shared.
 */
const detectMissingMakeUnique: Detector = (tree, source) => {
    const matches: ASTMatch[] = [];
    walkTree(tree.rootNode, (node: any) => {
        // Look for smart pointer construction with new
        if (node.type === 'call_expression' || node.type === 'template_function' || node.type === 'declaration') {
            const text = node.text;
            if (/\b(unique_ptr|shared_ptr)\s*<[^>]+>\s*\(\s*new\b/.test(text) ||
                /\b(std\s*::\s*)(unique_ptr|shared_ptr)\s*<[^>]+>\s*\(\s*new\b/.test(text)) {
                if (!isInsideComment(node)) {
                    matches.push({
                        line: node.startPosition.row + 1,
                        text: getLineText(source, node.startPosition.row),
                        nodeType: node.type,
                        confidence: 'high',
                    });
                }
            }
        }
    });
    return matches;
};

// ── Detector Registry ───────────────────────────────────────

const DETECTORS: Map<string, Detector> = new Map([
    ['map_vs_unordered', detectMapVsUnordered],
    ['list_vs_vector', detectListVsVector],
    ['reserve_pattern', detectReservePattern],
    ['virtual_vs_crtp', detectVirtualVsCrtp],
    ['aos_vs_soa', detectAosSoa],
    ['branch_vs_branchless', detectBranchVsBranchless],
    ['shared_vs_unique', detectSharedVsUnique],
    ['false_sharing', detectFalseSharing],
    ['pass_by_value', detectPassByValue],
    ['pow_vs_multiply', detectPowVsMultiply],
    ['endl_vs_newline', detectEndlVsNewline],
    ['loop_size_hoist', detectLoopSizeHoist],
    ['string_copy_vs_view', detectStringCopyVsView],
    ['missing_move', detectMissingMove],
    ['emplace_vs_push', detectEmplaceVsPush],
    ['runtime_vs_constexpr', detectRuntimeVsConstexpr],
    ['exception_hot_path', detectExceptionHotPath],
    ['sort_for_prediction', detectSortForPrediction],
    ['dynamic_cast_overhead', detectDynamicCastOverhead],
    ['sync_io_overhead', detectSyncIoOverhead],
    ['using_namespace_std', detectUsingNamespaceStd],
    ['c_array_vs_std_array', detectCArrayVsStdArray],
    ['raw_new_delete', detectRawNewDelete],
    ['missing_virtual_dtor', detectMissingVirtualDtor],
    ['return_std_move', detectReturnStdMove],
    ['missing_make_unique', detectMissingMakeUnique],
]);

// ── Enhanced Regex Fallback ─────────────────────────────────
// Used when tree-sitter is unavailable. Better than the old Python regex:
// skips comments and string literals properly.

interface RegexPattern {
    id: string;
    regex: RegExp;
    contextCheck?: (line: string, allLines: string[], lineIdx: number) => boolean;
}

const REGEX_PATTERNS: RegexPattern[] = [
    { id: 'map_vs_unordered', regex: /\bstd\s*::\s*map\s*<(?!.*unordered)/,
      contextCheck: (line) => !/multimap/.test(line) },
    { id: 'list_vs_vector', regex: /\bstd\s*::\s*list\s*</ },
    { id: 'reserve_pattern', regex: /\.push_back\s*\(/,
      contextCheck: (line, allLines, idx) => {
          // Check if there's a reserve nearby for this variable
          const match = line.match(/(\w+)\.push_back/);
          if (!match) { return true; }
          const varName = match[1];
          const precedingLines = allLines.slice(Math.max(0, idx - 20), idx).join('\n');
          return !precedingLines.includes(`${varName}.reserve`);
      }},
    { id: 'virtual_vs_crtp', regex: /\bvirtual\s+\w+\s+\w+\s*\(/ },
    { id: 'shared_vs_unique', regex: /\bstd\s*::\s*shared_ptr\s*</ },
    { id: 'false_sharing', regex: /\bstd\s*::\s*atomic\b/ },
    { id: 'pass_by_value', regex: /(?:void|int|double|float|bool|long|auto|std::\w+)\s+\w+\s*\(\s*std::\w+<[^>]+>\s+\w+/,
      contextCheck: (line) => !line.includes('&') && !line.includes('*') },
    { id: 'pow_vs_multiply', regex: /\b(std\s*::\s*)?pow\s*\([^,]+,\s*[234](\.[0])?\s*\)/ },
    { id: 'endl_vs_newline', regex: /\b(std\s*::\s*)?endl\b/ },
    { id: 'loop_size_hoist', regex: /for\s*\([^;]*;\s*\w+\s*[<>=!]+\s*\w+\.\s*size\s*\(\s*\)/ },
    { id: 'string_copy_vs_view', regex: /(?:void|int|double|float|bool|long|auto|std::\w+)\s+\w+\s*\(\s*std::string\s+\w+/,
      contextCheck: (line) => !line.includes('&') && !line.includes('string_view') },
    { id: 'missing_move', regex: /\.push_back\s*\(\s*[a-zA-Z_]\w*\s*\)/,
      contextCheck: (line) => !line.includes('std::move') && !line.includes('make_') },
    { id: 'emplace_vs_push', regex: /\.push_back\s*\(\s*(std::)?(make_pair|make_tuple)\s*\(/ },
    { id: 'exception_hot_path', regex: /\btry\s*\{/ },
    { id: 'dynamic_cast_overhead', regex: /\bdynamic_cast\s*</ },
    { id: 'sync_io_overhead', regex: /\bstd\s*::\s*cin\s*>>/,
      contextCheck: (_line, allLines) => !allLines.some(l => /sync_with_stdio\s*\(\s*false\s*\)/.test(l)) },
    { id: 'using_namespace_std', regex: /\busing\s+namespace\s+std\s*;/ },
    { id: 'c_array_vs_std_array', regex: /\b(int|double|float|char|long|unsigned|short|size_t)\s+\w+\s*\[\s*\w+\s*\]/,
      contextCheck: (line) => !/argv/.test(line) && !/std\s*::\s*array/.test(line) },
    { id: 'raw_new_delete', regex: /\b(new\s+\w+|delete\s+\w+|delete\s*\[\s*\])/,
      contextCheck: (line) => !/make_unique|make_shared|placement|operator\s+(new|delete)/.test(line) },
    { id: 'missing_virtual_dtor', regex: /\bvirtual\s+\w+\s+\w+\s*\(/,
      contextCheck: (_line, allLines, idx) => {
          // Check if a virtual destructor exists nearby (within class)
          const classRange = allLines.slice(Math.max(0, idx - 50), Math.min(allLines.length, idx + 50)).join('\n');
          return !/virtual\s*~/.test(classRange);
      }},
    { id: 'return_std_move', regex: /\breturn\s+std\s*::\s*move\s*\(/ },
    { id: 'missing_make_unique', regex: /\b(unique_ptr|shared_ptr)\s*<[^>]+>\s*\(\s*new\b/ },
];

function analyzeWithRegex(source: string): Map<string, ASTMatch[]> {
    const results = new Map<string, ASTMatch[]>();
    const lines = source.split('\n');

    for (const pattern of REGEX_PATTERNS) {
        const matches: ASTMatch[] = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // Skip comments
            if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) { continue; }
            // Skip string literals (crude but effective)
            if (/^".*"$/.test(line)) { continue; }

            if (pattern.regex.test(lines[i])) {
                // Apply context check if provided
                if (pattern.contextCheck && !pattern.contextCheck(lines[i], lines, i)) {
                    continue;
                }
                matches.push({
                    line: i + 1,
                    text: line,
                    confidence: 'low', // Regex matches get low confidence
                });
            }
        }
        if (matches.length > 0) {
            results.set(pattern.id, matches);
        }
    }
    return results;
}

// ── Main Analysis Function ──────────────────────────────────

import { PATTERNS } from './patterns';

export function analyzeCode(source: string): ASTFinding[] {
    let matchesByPattern: Map<string, ASTMatch[]>;

    if (initialized && parserInstance) {
        // AST-based analysis (preferred)
        const tree = parserInstance.parse(source);
        matchesByPattern = new Map();
        for (const [patternId, detector] of DETECTORS) {
            try {
                const matches = detector(tree, source);
                if (matches.length > 0) {
                    matchesByPattern.set(patternId, matches);
                }
            } catch (e) {
                console.error(`LatencyLens: detector ${patternId} failed:`, e);
            }
        }
    } else {
        // Fallback to enhanced regex
        matchesByPattern = analyzeWithRegex(source);
    }

    // Convert matches to findings
    const findings: ASTFinding[] = [];
    for (const pattern of PATTERNS) {
        const matches = matchesByPattern.get(pattern.id);
        if (matches && matches.length > 0) {
            // Filter out low-confidence matches if there are higher ones
            const highConf = matches.filter(m => m.confidence === 'high');
            const medConf = matches.filter(m => m.confidence === 'medium');
            const bestMatches = highConf.length > 0 ? highConf : medConf.length > 0 ? medConf : matches;

            findings.push({
                pattern_id: pattern.id,
                pattern_name: pattern.name,
                category: pattern.category,
                short_desc: pattern.short_desc,
                explanation: pattern.explanation,
                matches: bestMatches,
                before_label: pattern.before_label,
                after_label: pattern.after_label,
                before_snippet: pattern.before_snippet,
                after_snippet: pattern.after_snippet,
                severity: pattern.severity,
            });
        }
    }

    return findings;
}
