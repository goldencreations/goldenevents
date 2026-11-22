import { useRef, useState } from 'react';
import ReactCrop, { type PercentCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Modal, ErrorBox } from './ui';

export function ImageCropper({
  source,
  onClose,
  onSave,
}: {
  source: string;
  onClose: () => void;
  onSave: (file: File) => Promise<void>;
}) {
  const image = useRef<HTMLImageElement>(null);
  const [crop, setCrop] = useState<PercentCrop>({ unit: '%', x: 0, y: 0, width: 100, height: 100 });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!image.current || !ready) return;
    setBusy(true);
    setError('');
    try {
      const img = image.current;
      const width = (img.naturalWidth * crop.width) / 100;
      const height = (img.naturalHeight * crop.height) / 100;
      if (width < 1 || height < 1) throw new Error('Select a larger area.');
      const scale = Math.min(1, 1600 / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Your browser could not prepare the picture.');
      ctx.drawImage(
        img,
        (img.naturalWidth * crop.x) / 100,
        (img.naturalHeight * crop.y) / 100,
        width,
        height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('Could not prepare the picture.'))),
          'image/webp',
          0.9,
        ),
      );
      await onSave(new File([blob], 'event-picture.webp', { type: 'image/webp' }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Crop event picture"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>Keep the full picture, or drag the edges and corners to crop it to any shape.</p>
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="crop-stage">
        <ReactCrop
          crop={crop}
          onChange={(_, percent) => setCrop(percent)}
          disabled={busy}
          keepSelection
        >
          <img
            ref={image}
            src={source}
            alt="Picture to crop"
            onLoad={() => setReady(true)}
            onError={() => setError('This picture could not be loaded. Try another file.')}
          />
        </ReactCrop>
      </div>
      <div className="crop-actions">
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => setCrop({ unit: '%', x: 0, y: 0, width: 100, height: 100 })}
        >
          Use full picture
        </button>
        <button type="button" className="button primary" disabled={busy || !ready} onClick={save}>
          {busy ? 'Saving picture…' : 'Save picture'}
        </button>
      </div>
    </Modal>
  );
}
