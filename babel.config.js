module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Reanimated 4 moved the worklet transform into its own package;
      // `react-native-reanimated/plugin` is now only a shim forwarding here.
      //
      // This MUST stay last, after every other plugin — the transform has to see the
      // final output of the rest of the pipeline, or worklets silently fail to compile
      // and every animation falls back to running on the JS thread.
      'react-native-worklets/plugin',
    ],
  };
};
