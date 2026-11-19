import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { WorkspaceProvider } from './contexts/WorkspaceContext';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/Login/LoginPage';
import { RegisterPage } from './pages/Register/RegisterPage';
import { OnboardingPage } from './pages/Onboarding/OnboardingPage';
import { BrandSetupPage } from './pages/BrandSetup/BrandSetupPage';
import { DashboardPage } from './pages/Dashboard/DashboardPage';
import { CreatePostPage } from './pages/CreatePost/CreatePostPage';
import { ReviewQueuePage } from './pages/ReviewQueue/ReviewQueuePage';
import { ReviewDetailPage } from './pages/ReviewDetail/ReviewDetailPage';
import { CommentsPage } from './pages/Comments/CommentsPage';
import { GrowthPage } from './pages/Growth/GrowthPage';
import { ChannelsPage } from './pages/Channels/ChannelsPage';
import { ProfilePage } from './pages/Profile/ProfilePage';
import { BrandKnowledgePage } from './pages/BrandKnowledge/BrandKnowledgePage';
import { GovernanceInsightsPage } from './pages/Insights/GovernanceInsightsPage';

const ProtectedLayout: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children ? <>{children}</> : <AppLayout />;
};

export const App: React.FC = () => (
  <BrowserRouter>
    <AuthProvider>
      <WorkspaceProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/app" element={<ProtectedLayout />}>
            <Route index element={<Navigate to="/app/home" replace />} />
            <Route path="home" element={<DashboardPage />} />
            <Route path="create" element={<CreatePostPage />} />
            <Route path="review" element={<ReviewQueuePage />} />
            <Route path="review/:submissionId" element={<ReviewDetailPage />} />
            <Route path="comments" element={<CommentsPage />} />
            <Route path="growth" element={<GrowthPage />} />
            <Route path="channels" element={<ChannelsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="brand-knowledge" element={<BrandKnowledgePage />} />
            <Route path="insights" element={<GovernanceInsightsPage />} />
          </Route>
          <Route path="/onboarding" element={<ProtectedLayout><OnboardingPage /></ProtectedLayout>} />
          <Route path="/brand-setup" element={<ProtectedLayout><BrandSetupPage /></ProtectedLayout>} />
          <Route path="/" element={<Navigate to="/app/home" replace />} />
          <Route path="*" element={<Navigate to="/app/home" replace />} />
        </Routes>
      </WorkspaceProvider>
    </AuthProvider>
  </BrowserRouter>
);

export default App;
