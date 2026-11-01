// Injectable clock so deadlines and test windows can be tested.
let offsetMs = 0;
export const clock = { now: () => new Date(Date.now() + offsetMs), advance: (ms: number) => { offsetMs += ms; }, reset: () => { offsetMs = 0; } };
export const iso = (d = clock.now()) => d.toISOString();
