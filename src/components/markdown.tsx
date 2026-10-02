import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders assistant replies and saved notes. Raw HTML in the text is not rendered. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-chat" dir="auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
