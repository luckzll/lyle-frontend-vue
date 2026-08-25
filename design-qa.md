**Evidence**
- Source visual truth: `C:/Temp/codex-clipboard-b921be81-e475-4d87-8830-6451dd917972.png`
- Rendered implementation: `D:/vit/文档/Lyle/.worktrees/model-switcher-frontend/artifacts/design-qa/model-picker-composer.png`
- Full desktop view: `D:/vit/文档/Lyle/.worktrees/model-switcher-frontend/artifacts/design-qa/model-picker-desktop.png`
- Responsive view: `D:/vit/文档/Lyle/.worktrees/model-switcher-frontend/artifacts/design-qa/model-picker-mobile.png`
- Combined comparison: `D:/vit/文档/Lyle/.worktrees/model-switcher-frontend/artifacts/design-qa/model-picker-comparison.png`
- Viewport: desktop 1280 × 720 CSS px; mobile 390 × 844 CSS px; device scale factor 1.
- Source pixels: 2124 × 153. The focused source region was normalized to 984 × 71 for the combined comparison.
- Implementation pixels: focused composer 984 × 101; full desktop 1280 × 720; mobile 390 × 844.
- State: authenticated local QA fixture, new conversation, Qwen 3.7 Flash selected for the final capture.

**Findings**
- No actionable P0, P1, or P2 findings.
- Fonts and typography: existing application font stack and small-control weight remain consistent; labels are readable and do not wrap or truncate at the tested widths.
- Spacing and layout rhythm: the picker is reduced to a 34 px compact control; icon, label, chevron, divider, context text, and send action align on one baseline.
- Colors and visual tokens: the picker uses the existing primary-soft, primary-border, foreground, muted-foreground, and border tokens with sufficient visual separation.
- Image quality and asset fidelity: no raster imagery is required; the existing Lucide Sparkles and ChevronDown icons are preserved and render sharply.
- Copy and content: all price strings and the adjacent pricing description are removed. Model options contain names only. “当前项目 / 知识库” remains as secondary context.
- Responsive behavior: at 390 px the context label and divider are hidden, the picker stays visible, and the document has no horizontal overflow.
- Accessibility and interaction: the native select keeps its “对话模型” accessible label, focus treatment, disabled state, and keyboard-native behavior.

**Open Questions**
- None.

**Implementation Checklist**
- [x] Remove prices from the model data and option labels.
- [x] Remove the long inline model description from the composer footer.
- [x] Restyle the model picker with existing product tokens.
- [x] Preserve a visible model name, icon, chevron, and accessible native select.
- [x] Verify selection by switching from Qwen 3.7 Flash to Kimi K3 and back.
- [x] Verify desktop and 390 px mobile layouts.
- [x] Check browser console warnings/errors (none found).

**Follow-up Polish**
- No P3 follow-up is required for this scoped change.

**Comparison History**
- Pass 1: source and implementation were combined in `model-picker-comparison.png`. No P0/P1/P2 mismatch remained; no additional visual iteration was required.

final result: passed
