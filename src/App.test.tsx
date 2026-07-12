import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders the tab shell with the library tab active by default', () => {
    render(<App />);
    expect(screen.getByText('Library', { selector: '.tab-bar-label' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Library' })).toBeInTheDocument();
  });
});
