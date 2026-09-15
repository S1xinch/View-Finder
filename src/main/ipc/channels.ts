export const IpcChannels = {
  getAppInfo: 'app:get-info',
  getViewpoints: 'coolspot:get-viewpoints',
  // Pushed from main (event.sender.send) while a getViewpoints call is
  // still in flight - invoke() itself is one-shot request/response, so
  // incremental progress needs its own separate channel rather than
  // riding along on getViewpoints' eventual resolved value.
  viewpointsProgress: 'coolspot:viewpoints-progress',
  getExcludedLand: 'coolspot:get-excluded-land',
  getRoute: 'route:get-route',
  searchPlaces: 'place:search'
} as const
