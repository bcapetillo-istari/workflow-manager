import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { GatewayError } from '../gateway/types';
import { makeMockGateway, renderWithProviders } from '../test/renderWithProviders';
import { Catalog } from './Catalog';

describe('Catalog', () => {
  it('renders valid manifests as workflow cards and invalid ones as error cards', async () => {
    renderWithProviders(<Catalog />);
    expect(await screen.findByText('Smart Diff')).toBeInTheDocument();
    expect(screen.getByText('Diff, review, resolve')).toBeInTheDocument();
    expect(screen.getAllByTestId('workflow-card')).toHaveLength(2);

    const invalid = screen.getAllByTestId('invalid-card');
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toHaveTextContent('broken-workflow.json');
    const details = invalid[0]!.querySelector('details');
    expect(details?.open).toBe(false);
    fireEvent.click(screen.getByText(/errors?$/));
    expect(details?.open).toBe(true);
    // The README.md is not a manifest and must not appear at all.
    expect(screen.queryByText(/README/)).not.toBeInTheDocument();
  });

  it('shows an error state with Retry when the system cannot be listed', async () => {
    const gateway = makeMockGateway();
    gateway.failNext = {
      method: 'listTrackedResources',
      error: new GatewayError('Forbidden', { status: 403 }),
    };
    renderWithProviders(<Catalog />, { gateway });
    expect(await screen.findByText(/could not be read/)).toBeInTheDocument();
    expect(screen.getByText('Forbidden')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Smart Diff')).toBeInTheDocument();
  });
});
