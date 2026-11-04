const OPENERS =
  /^(?:should|shall|do|does|did|can|could|would|will|is|are|was|were|have|has|may|want|ok|okay|ready|sound|sounds|proceed|continue|go ahead|good to|mind if)\b/i;
const LEAD_INS = /^(?:(?:so|and|but|also|then|now|ok|okay|great|alright|if so)[,:]?\s+)+/i;

function asksYesNo(clause: string): boolean {
  return OPENERS.test(clause.replace(LEAD_INS, ""));
}

/**
 * Whether an assistant message ends on a question a bare "Yes" or "No" answers, so clients can
 * offer those as one-tap replies. Deliberately conservative: a question offering alternatives
 * ("A or B?") or a closing paragraph with several questions does not qualify.
 */
export function endsWithYesNoQuestion(text: string): boolean {
  const paragraph =
    text
      .trim()
      .split(/\n\s*\n/)
      .at(-1) ?? "";
  const plain = paragraph.replace(/[*_`~]/g, "").trim();
  if (!plain.endsWith("?") || plain.indexOf("?") !== plain.length - 1) return false;
  const sentence = (plain.split(/(?<=[.!:;])\s+|\n/).at(-1) ?? "").replace(/^[-+>#\s]+/, "");
  if (/\bor\b(?! not\b)/i.test(sentence)) return false;
  return asksYesNo(sentence) || sentence.split(/,\s+/).slice(1).some(asksYesNo);
}
