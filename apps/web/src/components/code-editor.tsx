import { lazy, Suspense } from 'react';
import { cn } from '@/lib/utils';
import type { MonacoProps } from './monaco-editor';

const Monaco = lazy(() => import('./monaco-editor'));

/** Editor de código (Monaco carregado sob demanda; textarea enquanto carrega). */
export function CodeEditor({ className, ...props }: MonacoProps & { className?: string }) {
  const h = typeof props.height === 'number' ? props.height : props.height ?? 240;
  return (
    <div className={cn('overflow-hidden rounded-lg border border-border-strong', className)}>
      <Suspense
        fallback={
          <textarea
            readOnly
            value={props.value}
            style={{ height: h }}
            className="w-full resize-none bg-surface p-3 font-mono text-[12.5px] text-muted"
          />
        }
      >
        <Monaco {...props} />
      </Suspense>
    </div>
  );
}
