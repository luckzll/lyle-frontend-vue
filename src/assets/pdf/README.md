# PDF fonts

Noto Sans SC and Noto Emoji from Google Fonts, under SIL Open Font License 1.1. Copyright and license texts are included here and in public/licenses/pdf/.

Sources:
- https://github.com/google/fonts/tree/main/ofl/notosanssc
- https://github.com/google/fonts/tree/main/ofl/notoemoji

Noto Sans SC source SHA-256: a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da

The variable Chinese source was instantiated at wght=400 with fontTools. A common delivery font retains GB2312 characters plus non-Han script/punctuation mappings. A full mapping font is loaded only for Han characters outside that set. Both are TrueType, gzip-compressed for delivery. The worker inflates them before embedding. The preprocessed font is embedded intact because this fontkit version can damage CJK composite glyphs during its own subsetting. The separate original Noto Emoji font supplies monochrome symbols when needed.
