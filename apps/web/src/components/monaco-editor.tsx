import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { useEffect, useState } from 'react';

// Monaco empacotado localmente (funciona offline, sem CDN)
(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};
loader.config({ monaco });

function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export interface MonacoProps {
  value: string;
  onChange?: (v: string) => void;
  language?: 'javascript' | 'json' | 'xml' | 'plaintext';
  height?: number | string;
  readOnly?: boolean;
}

export default function MonacoEditor({ value, onChange, language = 'json', height = 240, readOnly }: MonacoProps) {
  const dark = useIsDark();
  return (
    <Editor
      value={value}
      language={language}
      height={height}
      theme={dark ? 'vs-dark' : 'vs'}
      onChange={(v) => onChange?.(v ?? '')}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 12.5,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: 'on',
        lineNumbersMinChars: 3,
        padding: { top: 8, bottom: 8 },
        renderLineHighlight: 'none',
        scrollbar: { alwaysConsumeMouseWheel: false },
      }}
    />
  );
}
