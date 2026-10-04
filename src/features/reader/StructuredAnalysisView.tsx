import type { StructuredReadingAnalysis } from "../../core/ai/readingStructured";

interface Props {
  analysis: StructuredReadingAnalysis;
}

export function StructuredAnalysisView({ analysis }: Props) {
  if (analysis.kind === "raw") {
    return (
      <div className="structured-analysis">
        <section className="structured-primary">
          <span>AI response</span>
          <strong>Unstructured fallback</strong>
          <p>{analysis.note}</p>
        </section>
        <section>
          <div className="structured-raw-response">{analysis.text}</div>
        </section>
      </div>
    );
  }

  if (analysis.kind === "explanation") {
    return (
      <div className="structured-analysis">
        <section className="structured-primary">
          <span>Meaning in context</span>
          <strong>{analysis.meaningInContext}</strong>
          <p>{analysis.naturalChinese}</p>
          {(analysis.partOfSpeech || analysis.difficulty) && (
            <div className="structured-chips">
              {analysis.partOfSpeech && <em>{analysis.partOfSpeech}</em>}
              {analysis.difficulty && <em>{analysis.difficulty}</em>}
            </div>
          )}
        </section>

        {analysis.keyExpressions.length > 0 && (
          <section>
            <span className="structured-label">Key expressions</span>
            <div className="structured-item-list">
              {analysis.keyExpressions.map((item, index) => (
                <article key={item.text + ":" + index}>
                  <strong>{item.text}</strong>
                  <p>{item.meaning}</p>
                  {item.note && <small>{item.note}</small>}
                </article>
              ))}
            </div>
          </section>
        )}

        {analysis.usageNotes.length > 0 && (
          <section>
            <span className="structured-label">Usage notes</span>
            <ul>
              {analysis.usageNotes.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  if (analysis.kind === "grammar") {
    return (
      <div className="structured-analysis">
        <section className="structured-primary">
          <span>Natural Chinese</span>
          <strong>{analysis.naturalChinese}</strong>
          <p>{analysis.meaning}</p>
        </section>

        {analysis.structure.length > 0 && (
          <section>
            <span className="structured-label">Sentence structure</span>
            <div className="structured-item-list">
              {analysis.structure.map((item, index) => (
                <article key={item.part + ":" + index}>
                  <div className="structured-item-heading">
                    <strong>{item.part}</strong>
                    <em>{item.role}</em>
                  </div>
                  <p>{item.explanation}</p>
                </article>
              ))}
            </div>
          </section>
        )}

        {analysis.grammarPoints.length > 0 && (
          <section>
            <span className="structured-label">Grammar points</span>
            <div className="structured-item-list">
              {analysis.grammarPoints.map((item, index) => (
                <article key={item.name + ":" + index}>
                  <strong>{item.name}</strong>
                  <p>{item.explanation}</p>
                </article>
              ))}
            </div>
          </section>
        )}

        {analysis.features.length > 0 && (
          <section>
            <span className="structured-label">Sentence features</span>
            <ul>
              {analysis.features.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </section>
        )}

        {analysis.difficultExpressions.length > 0 && (
          <section>
            <span className="structured-label">Words & expressions in context</span>
            <div className="structured-item-list">
              {analysis.difficultExpressions.map((item, index) => (
                <article key={item.text + ":" + index}>
                  <strong>{item.text}</strong>
                  <p>{item.meaning}</p>
                  {item.note && <small>{item.note}</small>}
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  if (analysis.kind === "region") {
    return (
      <div className="structured-analysis">
        <section className="structured-primary">
          <span>Region analysis · {analysis.contentType}</span>
          <strong>{analysis.summary}</strong>
          {analysis.extractedText && (
            <p className="structured-extracted-text">
              {analysis.extractedText}
            </p>
          )}
        </section>

        {analysis.keyPoints.length > 0 && (
          <section>
            <span className="structured-label">Key points</span>
            <ul>
              {analysis.keyPoints.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </section>
        )}

        {analysis.visualDetails.length > 0 && (
          <section>
            <span className="structured-label">Visual details</span>
            <ul>
              {analysis.visualDetails.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="structured-analysis">
      <section className="structured-primary">
        <span>Answer</span>
        <strong>{analysis.answer}</strong>
      </section>

      {analysis.keyPoints.length > 0 && (
        <section>
          <span className="structured-label">Key points</span>
          <ul>
            {analysis.keyPoints.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
      )}

      {analysis.evidence.length > 0 && (
        <section>
          <span className="structured-label">Evidence from the text</span>
          <div className="structured-evidence">
            {analysis.evidence.map((item, index) => (
              <blockquote key={index}>{item}</blockquote>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
