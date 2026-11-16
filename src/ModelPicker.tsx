import { useId } from 'react';
import type { ReactNode } from 'react';
import { Select } from 'antd';
import './ModelPicker.css';

interface Option { value: string; label: string; disabled?: boolean }
interface Props {
  modelOptions: Option[];
  thinkingOptions: Option[];
  model?: string;
  thinking?: string;
  onModelChange: (value: string) => void;
  onThinkingChange: (value: string) => void;
  disabled?: boolean;
  modelDisabled?: boolean;
  thinkingDisabled?: boolean;
  loading?: boolean;
  modelLabel?: ReactNode;
  thinkingLabel?: ReactNode;
  modelAriaLabel?: string;
  thinkingAriaLabel?: string;
  modelPlaceholder?: string;
  thinkingPlaceholder?: string;
  modelHelp?: ReactNode;
  thinkingHelp?: ReactNode;
}

export default function ModelPicker({ modelOptions, thinkingOptions, model, thinking, onModelChange, onThinkingChange, disabled, modelDisabled, thinkingDisabled, loading, modelLabel = 'Model', thinkingLabel = 'Thinking', modelAriaLabel, thinkingAriaLabel, modelPlaceholder, thinkingPlaceholder, modelHelp, thinkingHelp }: Props) {
  const id = useId();
  return <div className="model-picker">
    <label htmlFor={`${id}-model`}>{modelLabel}<Select id={`${id}-model`} aria-label={modelAriaLabel} aria-describedby={modelHelp ? `${id}-model-help` : undefined} showSearch optionFilterProp="label" value={model} options={modelOptions} disabled={disabled || modelDisabled} loading={loading} placeholder={modelPlaceholder} onChange={onModelChange} />{modelHelp && <small id={`${id}-model-help`}>{modelHelp}</small>}</label>
    <label htmlFor={`${id}-thinking`}>{thinkingLabel}<Select id={`${id}-thinking`} aria-label={thinkingAriaLabel} aria-describedby={thinkingHelp ? `${id}-thinking-help` : undefined} showSearch optionFilterProp="label" value={thinking} options={thinkingOptions} disabled={disabled || thinkingDisabled} loading={loading} placeholder={thinkingPlaceholder} onChange={onThinkingChange} />{thinkingHelp && <small id={`${id}-thinking-help`}>{thinkingHelp}</small>}</label>
  </div>;
}
