import { Input, Modal } from 'antd';
import type { ReactNode } from 'react';

export async function requestReviewFeedback(modal: ReturnType<typeof Modal.useModal>[0], content: ReactNode, afterClose?: () => void): Promise<string | null> {
  let feedback = '';
  const dialog = modal.confirm({
    title: 'Request changes and queue another run?', autoFocusButton: 'cancel', mask: { closable: false },
    okText: 'Request changes', cancelText: 'Keep in review', okButtonProps: { disabled: true }, afterClose,
    content: <div>{content}<label>Required changes<Input.TextArea aria-label="Required changes" maxLength={4000} rows={4} onChange={event => {
      feedback = event.target.value.trim();
      dialog.update({ okButtonProps: { disabled: !feedback } });
    }} /></label><p>Feedback stays linked to this run and revision. A new attempt must still satisfy execution permissions and working-tree safety.</p></div>,
  });
  return await dialog ? feedback : null;
}
