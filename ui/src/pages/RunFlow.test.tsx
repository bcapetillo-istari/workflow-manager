import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AppRoutes } from '../App';
import { renderWithProviders } from '../test/renderWithProviders';

/** End to end through the real run engine (src/run) and the MockGateway: start, fill, run, finish. */
describe('Smart Diff run flow', () => {
  it('starts a run, submits the stage form, shows job progress and renders the summary when complete', async () => {
    const { auth } = renderWithProviders(<AppRoutes />, { route: '/workflows/smart-diff' });
    auth.signIn('token');

    // StartRun page lists the stages and starts a run.
    expect(await screen.findByRole('heading', { name: 'Smart Diff' })).toBeInTheDocument();
    expect(screen.getByText('Select documents and model')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    // RunDetail: stepper + form for the first stage.
    const form = await screen.findByText('Step 1: Select documents and model', {}, { timeout: 5000 });
    expect(form).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Start job' });
    expect(submit).toBeDisabled();

    // Pick two resources from the (unfiltered) search lists.
    const revB = await screen.findAllByRole('button', { name: /ICD-Flight-Control-Rev-B/ });
    fireEvent.click(revB[0]!);
    expect(await screen.findByText('(current)', { exact: false })).toBeInTheDocument();
    const revC = await screen.findAllByRole('button', { name: /ICD-Flight-Control-Rev-C/ });
    fireEvent.click(revC[0]!);

    // Credential drives the model options.
    const model = screen.getByLabelText(/Model/) as HTMLSelectElement;
    expect(model).toBeDisabled();
    fireEvent.click(await screen.findByLabelText(/OpenAI \(team key\)/));
    await waitFor(() => expect(model).toBeEnabled());
    fireEvent.change(model, { target: { value: 'gpt-4o' } });
    fireEvent.change(screen.getByLabelText(/Focus/), { target: { value: 'Signal timing' } });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    // Job stage shows progress with a job link, then the run completes and the summary renders.
    expect(await screen.findByText(/job job-/, {}, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('Comparing documents').length).toBeGreaterThan(0), {
      timeout: 8000,
    });
    await waitFor(() => expect(screen.getAllByText('succeeded').length).toBeGreaterThan(0), {
      timeout: 10000,
    });

    const results = screen.getByRole('heading', { name: 'Results' }).closest('div')!;
    const report = within(results).getByRole('link', { name: /report-/ });
    expect(report).toHaveAttribute('href', expect.stringMatching(/istari\.test\/resources\/res-/));
    expect(within(results).getByText('Summary')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
  }, 30000);
});
