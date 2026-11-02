// Asks the graph to bring a node into view and mark it briefly; the graph on screen answers
const showEvent = "ashborn:show-node";

export function showOnGraph(id: string) {
  window.dispatchEvent(new CustomEvent<string>(showEvent, { detail: id }));
}

export function onShowOnGraph(show: (id: string) => void) {
  const handle = (event: Event) => show((event as CustomEvent<string>).detail);
  window.addEventListener(showEvent, handle);
  return () => window.removeEventListener(showEvent, handle);
}
