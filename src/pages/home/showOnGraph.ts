// Asks the graph to bring a node into view and mark it briefly. The desktop's graph is on screen and
// answers at once; the phone's is a tab of its own, which takes the request as it opens.
const showEvent = "ashborn:show-node";
let waiting: string | null = null;

export function showOnGraph(id: string) {
  waiting = id;
  window.dispatchEvent(new CustomEvent<string>(showEvent, { detail: id }));
}

export function onShowOnGraph(show: (id: string) => void) {
  const handle = (event: Event) => show((event as CustomEvent<string>).detail);
  window.addEventListener(showEvent, handle);
  return () => window.removeEventListener(showEvent, handle);
}

// The node last asked for and not yet shown, once
export function takeWaitingShow() {
  const id = waiting;
  waiting = null;
  return id;
}
