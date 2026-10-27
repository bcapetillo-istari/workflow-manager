import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ManifestStage } from '../manifest/types';
import { renderWithProviders } from '../test/renderWithProviders';
import { StageForm } from './StageForm';

const stage: ManifestStage = {
  key: 's',
  name: 'Stage',
  inputs: [
    {
      key: 'title',
      label: 'Title',
      type: 'text',
      required: true,
      filter: { pattern: '^[A-Z]', max_length: 5 },
    },
    { key: 'count', label: 'Count', type: 'number', filter: { min: 1, max: 10 } },
    { key: 'flag', label: 'Flag', type: 'boolean', default: true },
  ],
};

describe('StageForm', () => {
  it('disables submit until required inputs are valid and applies defaults', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<StageForm stage={stage} run={null} onSubmit={onSubmit} />);
    const submit = screen.getByRole('button', { name: 'Submit' });
    expect(submit).toBeDisabled();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');

    const title = screen.getByLabelText(/Title/);
    fireEvent.change(title, { target: { value: 'lower' } });
    expect(await screen.findByText(/does not match/)).toBeInTheDocument();
    expect(submit).toBeDisabled();

    fireEvent.change(title, { target: { value: 'Toolong' } });
    expect(await screen.findByText(/at most 5 characters/)).toBeInTheDocument();

    fireEvent.change(title, { target: { value: 'Ok' } });
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '42' } });
    expect(await screen.findByText(/at most 10/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '3' } });
    await waitFor(() => expect(submit).toBeEnabled());

    fireEvent.click(submit);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ title: 'Ok', count: 3, flag: true }));
  });

  it('keeps an options_by select disabled until its source resolves, then shows the matching group', async () => {
    const dependent: ManifestStage = {
      key: 'd',
      name: 'Dependent',
      inputs: [
        {
          key: 'cred',
          label: 'Credential',
          type: 'auth_secret',
          required: true,
          filter: { secret_type: '@token:llm' },
        },
        {
          key: 'model',
          label: 'Model',
          type: 'enum',
          required: true,
          filter: {
            options_by: {
              source: '$inputs.cred.provider',
              groups: {
                openai: [{ value: 'gpt', label: 'GPT' }],
                claude: [{ value: 'opus', label: 'Opus' }],
              },
            },
          },
        },
      ],
    };
    renderWithProviders(<StageForm stage={dependent} run={null} onSubmit={() => undefined} />);
    const select = screen.getByLabelText(/Model/) as HTMLSelectElement;
    expect(select).toBeDisabled();
    expect(screen.getByText(/Waiting for a dependent selection/)).toBeInTheDocument();

    fireEvent.click(await screen.findByLabelText(/Anthropic \(personal\)/));
    await waitFor(() => expect(select).toBeEnabled());
    expect(screen.getByRole('option', { name: 'Opus' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'GPT' })).not.toBeInTheDocument();
  });

  it('shows the no-match message when the source value has no group', async () => {
    const s: ManifestStage = {
      key: 'n',
      name: 'N',
      inputs: [
        {
          key: 'cred',
          label: 'Credential',
          type: 'auth_secret',
          required: true,
          filter: { secret_type: '@token:git' },
        },
        {
          key: 'model',
          label: 'Model',
          type: 'enum',
          filter: { options_by: { source: '$inputs.cred.provider', groups: { openai: [] } } },
        },
      ],
    };
    renderWithProviders(<StageForm stage={s} run={null} onSubmit={() => undefined} />);
    fireEvent.click(await screen.findByLabelText(/GitHub/));
    expect(await screen.findByText(/No options available for “github”/)).toBeInTheDocument();
  });
});
