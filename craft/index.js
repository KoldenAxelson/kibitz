'use strict';

// CRAFT: the rules engine, all in one require for Node. In the window the
// same modules hang off window.KibitzCraft, loaded in this order by
// index.html: text, shapes, cut, echoes, landings, voice, suggest, lexicon,
// passes, scenes, zoom.

module.exports = {
  text: require('./text.js'),
  shapes: require('./shapes.js'),
  cut: require('./cut.js'),
  echoes: require('./echoes.js'),
  landings: require('./landings.js'),
  voice: require('./voice.js'),
  suggest: require('./suggest.js'),
  lexicon: require('./lexicon.js'),
  passes: require('./passes.js'),
  scenes: require('./scenes.js'),
  zoom: require('./zoom.js')
};
