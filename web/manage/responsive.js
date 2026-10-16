// On a phone the tables turn into cards (see styles.css). Each cell needs to know its column heading, so copy it onto the cell.
const labelTable = (table) => {
  const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  for (const tr of table.querySelectorAll('tbody tr')) {
    [...tr.children].forEach((td, i) => { const want = heads[i] || ''; if (td.getAttribute('data-label') !== want) td.setAttribute('data-label', want); });
  }
};

/** Keep every table's cells labelled as the page redraws. Call once. */
export function labelTables(root = document.body) {
  let queued = false;
  // the section strip scrolls sideways on a phone: keep the current section in view
  const run = () => {
    queued = false;
    root.querySelectorAll('table').forEach(labelTable);
    root.querySelectorAll('.subnav a.on').forEach((a) => a.scrollIntoView({ block: 'nearest', inline: 'center' }));
  };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } }).observe(root, { childList: true, subtree: true });
  run();
}
