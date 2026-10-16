import type { EditorView } from '@codemirror/view';

export function comparisonSelection(view: EditorView): string {
  const selection = view.dom.ownerDocument.getSelection();
  const inDeletedText = [selection?.anchorNode, selection?.focusNode].some(node => {
    const element = node?.nodeType === 1 ? node as Element : node?.parentElement;
    return element && view.dom.contains(element) && element.closest('.cm-deletedChunk');
  });
  // Unified deleted lines are widgets, outside the current document's offsets.
  if (inDeletedText && selection?.toString()) return selection.toString();
  return view.state.selection.ranges.filter(range => !range.empty).map(range => view.state.sliceDoc(range.from, range.to)).join('\n')
    || (selection?.anchorNode && view.dom.contains(selection.anchorNode) ? selection.toString() : '');
}
