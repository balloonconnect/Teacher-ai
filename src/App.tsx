import { People } from './pages/people';
import { AiUsage } from './pages/aiUsage';
import TamilTest from './pages/tamilTest';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Guard } from './auth';
import { Shell } from './components/Shell';
import { PublicLayout, Landing, Features, HowItWorks, Privacy, Terms, ChildSafety, Help, NotFound, SignIn } from './pages/public';
import { ForgotPassword, ResetPassword, VerifyEmail, GuardianApproval } from './pages/account';
import { SignUp } from './pages/signup';
import { Dashboard, Learn, Lesson, Bookmarks, Progress_, Practice } from './pages/student';
import { ProfilePage, Settings } from './pages/profile';
import { TestsList, TestDetail, TakeTest, Result, Review } from './pages/tests';
import { Certificates, Verify } from './pages/certs';
import { Tutor } from './pages/tutor';
import { ClassBooks, BookViewer, BookAdmin } from './pages/books';
import { VoiceTutor } from './pages/voice';
import { ParentHome, ParentChild, ParentAccount } from './pages/parent';
import { TeacherHome, Classes, ClassDetail, Questions, TeacherTests, TestBuilder, TestResults, Reviews, ReviewAttempt, CertAdmin, LessonReview } from './pages/teacher';
import type { ReactNode } from 'react';
import type { Role } from './auth';

const P = (el: ReactNode) => <PublicLayout>{el}</PublicLayout>;
const ALL: Role[] = ['student', 'parent', 'teacher', 'school_admin', 'admin', 'pending'];
const S = (roles: Role[], el: ReactNode) => <Guard roles={roles}><Shell>{el}</Shell></Guard>;

export default function App() {
  return (
    <Routes>
      <Route path="/" element={P(<Landing />)} /><Route path="/features" element={P(<Features />)} /><Route path="/how-it-works" element={P(<HowItWorks />)} />
      <Route path="/tamil-test" element={<TamilTest />} /><Route path="/privacy" element={P(<Privacy />)} /><Route path="/terms" element={P(<Terms />)} /><Route path="/child-safety" element={P(<ChildSafety />)} /><Route path="/help" element={P(<Help />)} />
      <Route path="/signin" element={P(<SignIn />)} /><Route path="/forgot-password" element={P(<ForgotPassword />)} /><Route path="/reset-password" element={P(<ResetPassword />)} /><Route path="/verify-email" element={P(<VerifyEmail />)} /><Route path="/guardian-approval" element={P(<GuardianApproval />)} /><Route path="/login" element={<Navigate to="/signin" replace />} /><Route path="/signup" element={P(<SignUp />)} />
      <Route path="/app" element={S(ALL, <Dashboard />)} />
      <Route path="/app/tutor" element={S(['student'], <Tutor />)} />
      <Route path="/app/learn" element={S(['student'], <Learn />)} /><Route path="/app/learn/:id" element={S(['student', 'teacher', 'school_admin', 'admin'], <Lesson />)} /><Route path="/teacher/lessons" element={S(['teacher', 'school_admin', 'admin'], <LessonReview />)} />
      <Route path="/app/voice" element={S(['student'], <VoiceTutor />)} /><Route path="/app/material" element={<Navigate to="/app/tutor?tab=material" replace />} /><Route path="/app/practice" element={S(['student'], <Practice />)} /><Route path="/app/books" element={S(['student'], <ClassBooks />)} /><Route path="/app/textbook/:id" element={S(['student'], <BookViewer />)} /><Route path="/teacher/books" element={S(['teacher'], <BookAdmin />)} /><Route path="/admin/people" element={S(['admin'], <People />)} /><Route path="/admin/ai" element={S(['admin'], <AiUsage />)} /><Route path="/admin/books" element={S(['admin'], <BookAdmin canEdit />)} />
      <Route path="/app/tests" element={S(['student'], <TestsList />)} /><Route path="/app/tests/:id" element={S(['student'], <TestDetail />)} />
      <Route path="/app/take/:id" element={S(['student'], <TakeTest />)} /><Route path="/app/result/:id" element={S(['student'], <Result />)} /><Route path="/app/review/:id" element={S(['student'], <Review />)} />
      <Route path="/app/progress" element={S(['student'], <Progress_ />)} /><Route path="/app/certificates" element={S(['student'], <Certificates />)} />
      <Route path="/app/bookmarks" element={S(['student'], <Bookmarks />)} /><Route path="/app/settings" element={S(['student'], <Settings />)} />
      <Route path="/parent" element={S(['parent'], <ParentHome />)} /><Route path="/parent/child/:id" element={S(['parent'], <ParentChild />)} /><Route path="/parent/settings" element={S(['parent'], <ParentAccount />)} />
      <Route path="/teacher" element={S(['teacher'], <TeacherHome />)} /><Route path="/teacher/classes" element={S(['teacher'], <Classes />)} /><Route path="/teacher/classes/:id" element={S(['teacher'], <ClassDetail />)} />
      <Route path="/teacher/questions" element={S(['teacher'], <Questions />)} /><Route path="/teacher/tests" element={S(['teacher'], <TeacherTests />)} /><Route path="/teacher/tests/new" element={S(['teacher'], <TestBuilder />)} />
      <Route path="/teacher/tests/:id" element={S(['teacher'], <TestBuilder />)} /><Route path="/teacher/tests/:id/results" element={S(['teacher'], <TestResults />)} />
      <Route path="/teacher/reviews" element={S(['teacher'], <Reviews />)} /><Route path="/teacher/review/:id" element={S(['teacher'], <ReviewAttempt />)} />
      <Route path="/teacher/certificates" element={S(['teacher'], <CertAdmin />)} />
      <Route path="/profile" element={<Guard roles={['student']} allowIncompleteProfile><ProfilePage /></Guard>} />
      <Route path="/verify" element={<Verify />} /><Route path="/verify/:token" element={<Verify />} />
      <Route path="/app/*" element={<Navigate to="/app" replace />} />
      <Route path="/home" element={<Navigate to="/" replace />} />
      <Route path="*" element={P(<NotFound />)} />
    </Routes>
  );
}
