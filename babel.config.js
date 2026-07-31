module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Reanimated's worklet transform MUST be last, after every other plugin.
      'react-native-reanimated/plugin',
    ],
  };
};
