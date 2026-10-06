// Target languages shared by the extension (popup, background) and the local service.
// The extension build copies this file into the extension as languages.js.
// Subtitles are always translated from English. `code` is the stored setting, the Google
// Cloud Translation code and part of the episode hash; `name` is shown in the UI and used in
// model prompts. `local` marks languages supported by the Hy-MT2 model; `wide` marks scripts
// that use full-width brackets in subtitles.
(function (scope) {
  const list = [
    ['zh-CN', 'Chinese (Simplified)', true, true], ['zh-TW', 'Chinese (Traditional)', true, true], ['yue', 'Cantonese', true, true],
    ['ja', 'Japanese', true, true], ['ko', 'Korean', true], ['es', 'Spanish', true], ['fr', 'French', true], ['de', 'German', true],
    ['it', 'Italian', true], ['pt', 'Portuguese', true], ['ru', 'Russian', true], ['uk', 'Ukrainian', true], ['pl', 'Polish', true],
    ['cs', 'Czech', true], ['nl', 'Dutch', true], ['tr', 'Turkish', true], ['ar', 'Arabic', true], ['he', 'Hebrew', true],
    ['fa', 'Persian', true], ['hi', 'Hindi', true], ['bn', 'Bengali', true], ['ur', 'Urdu', true], ['mr', 'Marathi', true],
    ['gu', 'Gujarati', true], ['ta', 'Tamil', true], ['te', 'Telugu', true], ['th', 'Thai', true], ['vi', 'Vietnamese', true],
    ['id', 'Indonesian', true], ['ms', 'Malay', true], ['tl', 'Filipino', true], ['km', 'Khmer', true], ['my', 'Burmese', true],
    ['bo', 'Tibetan', true], ['kk', 'Kazakh', true], ['mn', 'Mongolian', true], ['ug', 'Uyghur', true],
    ['sv', 'Swedish'], ['da', 'Danish'], ['no', 'Norwegian'], ['fi', 'Finnish'], ['el', 'Greek'], ['hu', 'Hungarian'],
    ['ro', 'Romanian'], ['bg', 'Bulgarian'], ['hr', 'Croatian'], ['sr', 'Serbian'], ['sk', 'Slovak'], ['sl', 'Slovenian'],
    ['lt', 'Lithuanian'], ['lv', 'Latvian'], ['et', 'Estonian'], ['ca', 'Catalan'], ['sw', 'Swahili'], ['af', 'Afrikaans']
  ].map(([code, name, local = false, wide = false]) => Object.freeze({ code, name, local, wide }));
  const byCode = new Map(list.map(language => [language.code, language]));
  scope.SubtitleLanguages = Object.freeze({ list, defaultCode: 'zh-CN', get: code => byCode.get(code) || null });
})(globalThis);
