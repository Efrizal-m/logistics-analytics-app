import { answerMeta, answerParagraphs } from "../derive";
import type { AskResponse } from "../types";

interface Props {
  result: AskResponse;
  onExampleClick: (question: string) => void;
}

export function AnswerBlock({ result, onExampleClick }: Props) {
  const paragraphs = answerParagraphs(result.answer);
  const unsupported = result.unsupported;

  return (
    <>
      <div style={{ borderTop: `1px solid ${unsupported ? "var(--warn)" : "var(--line-2)"}`, paddingTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          {unsupported && <span style={{ width: 5, height: 5, background: "var(--warn)", display: "block" }} />}
          <span
            style={{
              fontFamily: "var(--font-m)",
              fontSize: "var(--t-micro)",
              fontWeight: 600,
              letterSpacing: "0.13em",
              textTransform: "uppercase",
              color: unsupported ? "var(--warn-text)" : "var(--faint)",
            }}
          >
            {unsupported ? "Outside this dataset" : "Answer"}
          </span>
          <span className="la-meta" style={{ marginLeft: "auto" }}>
            {answerMeta(result)}
          </span>
        </div>
        <div className="la-answer" style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 11, maxWidth: "88ch" }}>
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </div>

      {unsupported && result.supported_examples.length > 0 && (
        <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <div
            style={{
              fontFamily: "var(--font-m)",
              fontSize: "var(--t-micro)",
              fontWeight: 600,
              letterSpacing: "0.13em",
              textTransform: "uppercase",
              color: "var(--faint)",
              marginBottom: 7,
            }}
          >
            Questions this dataset can answer
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {result.supported_examples.map((example) => (
              <button
                key={example}
                type="button"
                className="la-chip la-chip--accent"
                onClick={() => onExampleClick(example)}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
