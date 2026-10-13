class LocalifyLogger {
  static write(event, data={}) {
    try {
      const line={time:new Date().toISOString(),event,data};
      const key="localify.logs";
      const logs=JSON.parse(localStorage.getItem(key)||"[]").slice(-199);
      logs.push(line); localStorage.setItem(key,JSON.stringify(logs));
    } catch {}
  }
}
if(typeof window!=="undefined") window.LocalifyLogger=LocalifyLogger;
if(typeof module!=="undefined" && module.exports) module.exports={LocalifyLogger};
