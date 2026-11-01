/** Stop Dictation on NSApplication, bypassing Chromium's first responder. */
export async function stopMacOsDictation(): Promise<boolean> {
  const { DataType, load, open } = await import("ffi-rs");
  const library = "t3-dictation-objc";
  open({ library, path: "/usr/lib/libobjc.A.dylib" });
  const selector = (name: string) =>
    load({
      library,
      funcName: "sel_registerName",
      retType: DataType.BigInt,
      paramsType: [DataType.String],
      paramsValue: [name],
    });
  const applicationClass = load({
    library,
    funcName: "objc_getClass",
    retType: DataType.BigInt,
    paramsType: [DataType.String],
    paramsValue: ["NSApplication"],
  });
  const application = load({
    library,
    funcName: "objc_msgSend",
    retType: DataType.BigInt,
    paramsType: [DataType.BigInt, DataType.BigInt],
    paramsValue: [applicationClass, selector("sharedApplication")],
  });
  const stop = selector("stopDictation:");
  const supported = load({
    library,
    funcName: "objc_msgSend",
    retType: DataType.Boolean,
    paramsType: [DataType.BigInt, DataType.BigInt, DataType.BigInt],
    paramsValue: [application, selector("respondsToSelector:"), stop],
  });
  if (!supported) return false;
  // Keep this synchronous on Electron's main thread: AppKit owns the session.
  load({
    library,
    funcName: "objc_msgSend",
    retType: DataType.Void,
    paramsType: [DataType.BigInt, DataType.BigInt, DataType.BigInt],
    paramsValue: [application, stop, 0n],
  });
  return true;
}
