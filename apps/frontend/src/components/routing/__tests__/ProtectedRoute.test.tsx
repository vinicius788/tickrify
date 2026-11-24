import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ProtectedRoute from '@/components/routing/ProtectedRoute';
import { useAuth } from '@clerk/clerk-react';

vi.mock('@clerk/clerk-react', () => ({
  useAuth: vi.fn(),
}));

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renderiza children quando autenticado', () => {
    vi.mocked(useAuth).mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
    } as ReturnType<typeof useAuth>);

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/sign-in" element={<div>Sign In Page</div>} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <div>Conteúdo Protegido</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Conteúdo Protegido')).toBeTruthy();
  });

  it('redireciona para /sign-in quando não autenticado', () => {
    vi.mocked(useAuth).mockReturnValue({
      isLoaded: true,
      isSignedIn: false,
    } as ReturnType<typeof useAuth>);

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/sign-in" element={<div>Sign In Page</div>} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <div>Conteúdo Protegido</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Sign In Page')).toBeTruthy();
  });

  it('painel do afiliado sem login: vai ao login e volta para /affiliate depois', () => {
    vi.mocked(useAuth).mockReturnValue({ isLoaded: true, isSignedIn: false } as ReturnType<typeof useAuth>);
    const SignInSpy = () => <div>{useLocation().search}</div>;

    render(
      <MemoryRouter initialEntries={['/affiliate']}>
        <Routes>
          <Route path="/sign-in" element={<SignInSpy />} />
          <Route path="/affiliate" element={<ProtectedRoute><div>Painel</div></ProtectedRoute>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('?redirect_url=%2Faffiliate')).toBeTruthy();
  });
});
