import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Renders a model reply. Raw HTML in the text is not rendered, so replies cannot inject markup. */
export default function Markdown({ text }: { text: string }) {
  return (
    <div className="assistant-markdown" dir="auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="assistant-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
