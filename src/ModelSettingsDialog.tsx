import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDownToLine, Check, LoaderCircle, Sparkles, X } from 'lucide-react';
import type { ModelProgress, ModelStatus } from './types';

export interface ModelSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: ModelStatus;
  progress: ModelProgress | null;
  aiError: string;
  onDownload: () => void;
  onCancelDownload: () => void;
}

export function ModelSettingsDialog({
  open,
  onOpenChange,
  model,
  progress,
  aiError,
  onDownload,
  onCancelDownload,
}: ModelSettingsDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog model-dialog">
          <Dialog.Close className="icon-button close" aria-label="Chiudi impostazioni AI">
            <X size={20} />
          </Dialog.Close>
          <span className="model-icon">
            <Sparkles size={26} />
          </span>
          <Dialog.Title>La tua AI, sul tuo PC.</Dialog.Title>
          <Dialog.Description>
            Gratuita, senza account e senza chiavi API. Il modello viene scaricato una volta e
            lavora in locale.
          </Dialog.Description>
          <div className="model-spec">
            <strong>Qwen3.5 · 2B</strong>
            <span>1,4 GB · Apache 2.0</span>
            <p>Le offerte arrivano dalle fonti online. L’AI aiuta a leggerne le condizioni.</p>
          </div>
          {model.downloading && (
            <div className="download-progress">
              <div>
                <span>{progress?.stage ?? 'Preparazione download…'}</span>
                <span>{Math.round(((progress?.downloaded ?? 0) / model.size) * 100)}%</span>
              </div>
              <progress max={model.size} value={progress?.downloaded ?? 0} />
            </div>
          )}
          {model.installed ? (
            <div className="model-ready">
              <Check size={18} />
              Modello pronto all’uso
            </div>
          ) : (
            <button
              className="button primary full-width"
              disabled={model.downloading}
              onClick={onDownload}
            >
              {model.downloading ? (
                <>
                  <LoaderCircle className="spin" size={16} />
                  Download in corso
                </>
              ) : (
                <>
                  <ArrowDownToLine size={17} />
                  Scarica e attiva AI
                </>
              )}
            </button>
          )}
          {model.downloading && (
            <button className="text-button" onClick={onCancelDownload}>
              Sospendi download
            </button>
          )}
          {model.installed && !model.downloading && (
            <button className="text-button" onClick={onDownload}>
              Verifica o ripara il modello
            </button>
          )}
          {aiError && (
            <p role="alert" className="inline-error">
              {aiError}
            </p>
          )}
          <p className="model-note">
            Puoi continuare a consultare le offerte durante il download. Il modello richiede memoria
            aggiuntiva durante l’uso.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
