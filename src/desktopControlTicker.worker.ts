// @file desktopControlTicker.worker.ts
// @author: ForUltraplayer
// @brief Keep desktop control state, hit regions and expiry checks ticking independently of background window timers.
export {};
self.setInterval(() => self.postMessage('tick'), 500);
