// Liga a identidade do Clerk ao PostHog e dispara `signup_completed` para contas novas.
// Renderizar uma vez, dentro do <ClerkProvider>.
import { useEffect, useRef } from 'react';
import { useUser } from '@clerk/clerk-react';
import { identifyUser, track } from '@/lib/analytics';

export function AnalyticsIdentify() {
  const { isLoaded, isSignedIn, user } = useUser();
  const signupTracked = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;

    identifyUser(user.id, {
      email: user.primaryEmailAddress?.emailAddress,
      createdAt: user.createdAt,
    });

    // signup_completed: uma vez por usuário recém-criado (heurística: conta < 60s).
    // Fonte 100% confiável seria um webhook user.created do Clerk no backend.
    if (!signupTracked.current && user.createdAt) {
      const ageMs = Date.now() - new Date(user.createdAt).getTime();
      if (ageMs >= 0 && ageMs < 60_000) {
        track('signup_completed');
      }
      signupTracked.current = true;
    }
  }, [isLoaded, isSignedIn, user]);

  return null;
}
