const paths = {
  leaf: "M20 4C9 3 3 8 5 15c2 7 12 6 15-11ZM5 20 15 10M10 15v-5m0 5h5",
  temple: "m3 9 9-6 9 6H3Zm2 1v8m5-8v8m4-8v8m5-8v8M2 21h20M4 18h16M12 1v3",
  beads:
    "M9 3a3 3 0 0 1 6 0M4 6a3 3 0 1 1 4 4 3 3 0 0 1-4-4Zm13 0a3 3 0 1 1 4 4 3 3 0 0 1-4-4ZM3 13a3 3 0 1 1 1 6 3 3 0 0 1-1-6Zm14 3a3 3 0 1 1 6 0 3 3 0 0 1-6 0ZM9 21a3 3 0 1 1 6 0M12 21v3",
  grid: "M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z",
  book: "M12 5C7 1 2 4 2 4v16s5-3 10 1c5-4 10-1 10-1V4s-5-3-10 1Zm0 0v16",
  people:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-7a4 4 0 0 1 0 7",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  close: "m6 6 12 12M6 18 18 6",
  sun: "M12 3V1m0 22v-2M3 12H1m22 0h-2M4.2 4.2 2.8 2.8m18.4 18.4-1.4-1.4M4.2 19.8l-1.4 1.4M21.2 2.8l-1.4 1.4M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z",
  volume: "m11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
  mute: "m11 4-6 5H2v6h3l6 5V4Zm5 5 6 6m0-6-6 6",
  help: "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3m.1 4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  pin: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  wind: "M3 8h12a3 3 0 1 0-3-3M2 12h17a3 3 0 1 1-3 3M4 16h6a3 3 0 1 1-3 3",
  spark: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z",
  bag: "M5 7h14l2 14H3L5 7Zm3 0V5a4 4 0 0 1 8 0v2",
  bow: "M9 5a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm-2 7 4-3 4 4 5 1M11 9l-2 8-5 3m5-3 6 3h5",
  chat: "M21 11a9 9 0 0 1-9 9c-2 0-4-.5-5-1l-5 2 2-5a9 9 0 1 1 17-5Z",
  send: "m22 2-7 20-4-9-9-4L22 2ZM11 13 22 2",
  check: "m5 12 4 4L19 6",
  lock: "M5 10h14v11H5Zm3 0V6a4 4 0 0 1 8 0v4",
  gift: "M3 8h18v4H3Zm2 4v9h14v-9M12 8v13M12 8H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z",
  speed: "M20 18a9 9 0 1 0-16 0m8-5 5-5M7 17h10",
  reset: "M3 10a9 9 0 1 1 2 8M3 4v6h6",
};
export const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.spark}"/></svg>`;
