/**
 * ============================================================
 * © 2025 Diploy — a brand of Bisht Technologies Private Limited
 * Original Author: BTPL Engineering Team
 * Website: https://diploy.in
 * Contact: cs@diploy.in
 *
 * Distributed under the Envato / CodeCanyon License Agreement.
 * Licensed to the purchaser for use as defined by the
 * Envato Market (CodeCanyon) Regular or Extended License.
 *
 * You are NOT permitted to redistribute, resell, sublicense,
 * or share this source code, in whole or in part.
 * Respect the author's rights and Envato licensing terms.
 * ============================================================
 */
import { useState, useEffect, createContext, useContext, useCallback } from "react";
import { X, Mail, ArrowRight, AlertCircle, Loader2, KeyRound, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useBranding } from "@/components/BrandingProvider";
import { Link } from "wouter";
import { AuthStorage } from "@/lib/auth-storage";
import { AILoadingAnimation } from "./AILoadingAnimation";

interface AuthDialogContextType {
  isOpen: boolean;
  activeTab: "login" | "register";
  openAuth: (tab?: "login" | "register") => void;
  closeAuth: () => void;
}

const AuthDialogContext = createContext<AuthDialogContextType | null>(null);

export function useAuthDialog() {
  const context = useContext(AuthDialogContext);
  if (!context) {
    return {
      isOpen: false,
      activeTab: "login" as const,
      openAuth: (tab?: "login" | "register") => {
        // Navigate to landing page with auth query param (SPA-friendly)
        const authType = tab || "login";
        window.history.pushState({}, "", `/?auth=${authType}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      },
      closeAuth: () => {},
    };
  }
  return context;
}

interface AuthDialogProviderProps {
  children: React.ReactNode;
}

export function AuthDialogProvider({ children }: AuthDialogProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  const [showLoadingAnimation, setShowLoadingAnimation] = useState(false);
  const [loadingUserName, setLoadingUserName] = useState<string | undefined>();
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);

  // Check for ?auth=login or ?auth=register query parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authParam = params.get("auth");
    if (authParam === "login" || authParam === "register") {
      setActiveTab(authParam);
      setIsOpen(true);
      // Clean up URL without reload
      const newUrl = window.location.pathname;
      window.history.replaceState({}, "", newUrl);
    }
  }, []);

  const openAuth = (tab: "login" | "register" = "login") => {
    setActiveTab(tab);
    setIsOpen(true);
  };

  const closeAuth = () => {
    setIsOpen(false);
  };

  const showLoading = useCallback((userName: string, redirectUrl: string) => {
    setIsOpen(false);
    setLoadingUserName(userName);
    setPendingRedirect(redirectUrl);
    setShowLoadingAnimation(true);
  }, []);

  const handleLoadingComplete = useCallback(() => {
    if (pendingRedirect) {
      window.location.href = pendingRedirect;
    }
  }, [pendingRedirect]);

  return (
    <AuthDialogContext.Provider value={{ isOpen, activeTab, openAuth, closeAuth }}>
      {children}
      <AuthDialogContent 
        isOpen={isOpen} 
        onClose={closeAuth} 
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onAuthSuccess={showLoading}
      />
      <AILoadingAnimation 
        isVisible={showLoadingAnimation}
        onComplete={handleLoadingComplete}
        userName={loadingUserName}
      />
    </AuthDialogContext.Provider>
  );
}

interface AuthDialogContentProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: "login" | "register";
  setActiveTab: (tab: "login" | "register") => void;
  onAuthSuccess?: (userName: string, redirectUrl: string) => void;
}

type AuthView = "login" | "register" | "forgot-password" | "reset-password";

function AuthDialogContent({ isOpen, onClose, activeTab, setActiveTab, onAuthSuccess }: AuthDialogContentProps) {
  const { toast } = useToast();
  const { branding, currentLogo } = useBranding();
  const [isLoading, setIsLoading] = useState(false);
  const [authView, setAuthView] = useState<AuthView>("login");
  const [showPassword, setShowPassword] = useState(false);
  
  const [loginForm, setLoginForm] = useState({
    email: "",
    password: "",
  });
  
  const [registerForm, setRegisterForm] = useState({
    email: "",
    password: "",
    name: "",
    acceptedTerms: false,
  });
  
  const [forgotPasswordForm, setForgotPasswordForm] = useState({
    email: "",
  });
  
  const [resetPasswordForm, setResetPasswordForm] = useState({
    email: "",
    newPassword: "",
    confirmPassword: "",
  });
  
  const [signupStep, setSignupStep] = useState<"details" | "otp">("details");
  const [forgotPasswordStep, setForgotPasswordStep] = useState<"email" | "otp" | "new-password">("email");
  const [otpCode, setOtpCode] = useState("");
  const [otpTimer, setOtpTimer] = useState(0);
  const [canResendOtp, setCanResendOtp] = useState(false);

  useEffect(() => {
    if (activeTab === "login") {
      setAuthView("login");
    } else {
      setAuthView("register");
    }
  }, [activeTab]);

  useEffect(() => {
    if (otpTimer > 0) {
      const timer = setTimeout(() => setOtpTimer(otpTimer - 1), 1000);
      return () => clearTimeout(timer);
    } else if (otpTimer === 0 && (signupStep === "otp" || forgotPasswordStep === "otp")) {
      setCanResendOtp(true);
    }
  }, [otpTimer, signupStep, forgotPasswordStep]);

  useEffect(() => {
    if (!isOpen) {
      setSignupStep("details");
      setForgotPasswordStep("email");
      setOtpCode("");
      setOtpTimer(0);
      setCanResendOtp(false);
      setAuthView(activeTab === "login" ? "login" : "register");
      setShowPassword(false);
    }
  }, [isOpen, activeTab]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Login failed");
      }
      
      AuthStorage.setAuthData(data.token, data.user, data.refreshToken, data.expiresIn);
      
      toast({
        title: "Welcome back!",
        description: `Logged in as ${data.user.name}`,
      });
      
      const redirectUrl = data.user.role === 'admin' ? "/admin" : "/app";
      
      if (onAuthSuccess) {
        onAuthSuccess(data.user.name, redirectUrl);
      } else {
        onClose();
        window.location.href = redirectUrl;
      }
    } catch (error: any) {
      toast({
        title: "Login failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!registerForm.acceptedTerms) {
      toast({
        title: "Terms required",
        description: "Please accept the Terms of Service and Privacy Policy",
        variant: "destructive",
      });
      return;
    }
    
    setIsLoading(true);
    
    try {
      const response = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: registerForm.email,
          name: registerForm.name,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to send verification code");
      }
      
      toast({
        title: "Code sent!",
        description: `Check your email at ${registerForm.email}`,
      });
      
      setSignupStep("otp");
      setOtpTimer(300);
      setCanResendOtp(false);
      setOtpCode("");
    } catch (error: any) {
      toast({
        title: "Failed to send code",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOTP = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: registerForm.email,
          name: registerForm.name,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to resend verification code");
      }
      
      toast({
        title: "Code resent",
        description: "A new verification code has been sent",
      });
      
      setOtpTimer(300);
      setCanResendOtp(false);
      setOtpCode("");
    } catch (error: any) {
      toast({
        title: "Failed to resend",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      const verifyResponse = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: registerForm.email,
          otpCode,
        }),
      });
      
      const verifyData = await verifyResponse.json();
      
      if (!verifyResponse.ok) {
        throw new Error(verifyData.error || "Invalid verification code");
      }
      
      const registerResponse = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: registerForm.email,
          password: registerForm.password,
          name: registerForm.name,
        }),
      });
      
      const registerData = await registerResponse.json();
      
      if (!registerResponse.ok) {
        throw new Error(registerData.error || "Registration failed");
      }
      
      AuthStorage.setAuthData(registerData.token, registerData.user, registerData.refreshToken, registerData.expiresIn);
      
      toast({
        title: "Account created!",
        description: `Welcome, ${registerData.user.name}`,
      });
      
      const redirectUrl = registerData.user.role === 'admin' ? "/admin" : "/app";
      
      if (onAuthSuccess) {
        onAuthSuccess(registerData.user.name, redirectUrl);
      } else {
        onClose();
        window.location.href = redirectUrl;
      }
    } catch (error: any) {
      toast({
        title: "Verification failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPasswordSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      const response = await fetch("/api/auth/forgot-password/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: forgotPasswordForm.email,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to send verification code");
      }
      
      toast({
        title: "Code sent!",
        description: "If an account exists, check your email for the code",
      });
      
      setResetPasswordForm({ ...resetPasswordForm, email: forgotPasswordForm.email });
      setForgotPasswordStep("otp");
      setOtpTimer(300);
      setCanResendOtp(false);
      setOtpCode("");
    } catch (error: any) {
      toast({
        title: "Failed to send code",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPasswordResendOTP = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/forgot-password/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: forgotPasswordForm.email,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to resend verification code");
      }
      
      toast({
        title: "Code resent",
        description: "A new verification code has been sent",
      });
      
      setOtpTimer(300);
      setCanResendOtp(false);
      setOtpCode("");
    } catch (error: any) {
      toast({
        title: "Failed to resend",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPasswordVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      const response = await fetch("/api/auth/forgot-password/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: forgotPasswordForm.email,
          otpCode,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Invalid verification code");
      }
      
      toast({
        title: "Verified!",
        description: "Now set your new password",
      });
      
      setForgotPasswordStep("new-password");
    } catch (error: any) {
      toast({
        title: "Verification failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (resetPasswordForm.newPassword !== resetPasswordForm.confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "Please make sure both passwords are the same",
        variant: "destructive",
      });
      return;
    }
    
    if (resetPasswordForm.newPassword.length < 6) {
      toast({
        title: "Password too short",
        description: "Password must be at least 6 characters",
        variant: "destructive",
      });
      return;
    }
    
    setIsLoading(true);
    
    try {
      const response = await fetch("/api/auth/forgot-password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: resetPasswordForm.email,
          newPassword: resetPasswordForm.newPassword,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to reset password");
      }
      
      toast({
        title: "Password reset!",
        description: "You can now sign in with your new password",
      });
      
      setAuthView("login");
      setActiveTab("login");
      setForgotPasswordStep("email");
      setLoginForm({ email: resetPasswordForm.email, password: "" });
    } catch (error: any) {
      toast({
        title: "Reset failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getDialogTitle = () => {
    switch (authView) {
      case "login": return "Welcome back";
      case "register": return "Create your account";
      case "forgot-password": return "Reset password";
      case "reset-password": return "New password";
      default: return "Sign In";
    }
  };

  const getDialogDescription = () => {
    switch (authView) {
      case "login": return "Sign in to your account";
      case "register": return "Get started with AI-powered calling";
      case "forgot-password": return "Enter your email to receive a reset code";
      case "reset-password": return "Enter your new password";
      default: return "";
    }
  };

  const renderForgotPassword = () => {
    if (forgotPasswordStep === "email") {
      return (
        <form onSubmit={handleForgotPasswordSendOTP} className="space-y-4">
          <div className="text-center space-y-3 mb-6">
            <div className="flex justify-center">
              <div className="h-14 w-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <KeyRound className="h-7 w-7 text-amber-600 dark:text-amber-400" />
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-lg">Forgot password?</h3>
              <p className="text-sm text-muted-foreground">
                Enter your email and we'll send you a reset code
              </p>
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="forgot-email">Email</Label>
            <Input
              id="forgot-email"
              type="email"
              placeholder="you@company.com"
              value={forgotPasswordForm.email}
              onChange={(e) => setForgotPasswordForm({ email: e.target.value })}
              required
              className="h-11"
              data-testid="input-forgot-email"
            />
          </div>
          
          <Button
            type="submit"
            className="w-full h-11 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900"
            disabled={isLoading}
            data-testid="button-forgot-send-otp"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                Send Reset Code
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
          
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setAuthView("login");
              setActiveTab("login");
            }}
            data-testid="button-back-to-login"
          >
            Back to Sign In
          </Button>
        </form>
      );
    }
    
    if (forgotPasswordStep === "otp") {
      return (
        <form onSubmit={handleForgotPasswordVerifyOTP} className="space-y-6">
          <div className="text-center space-y-3">
            <div className="flex justify-center">
              <div className="h-14 w-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <Mail className="h-7 w-7 text-slate-600 dark:text-slate-300" />
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-lg">Check your email</h3>
              <p className="text-sm text-muted-foreground">
                We sent a code to <strong className="text-foreground">{forgotPasswordForm.email}</strong>
              </p>
            </div>
          </div>
          
          <div className="flex justify-center">
            <InputOTP
              maxLength={6}
              value={otpCode}
              onChange={setOtpCode}
              data-testid="input-forgot-otp"
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>
          
          {otpTimer > 0 && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              <span>Code expires in {Math.floor(otpTimer / 60)}:{String(otpTimer % 60).padStart(2, "0")}</span>
            </div>
          )}
          
          <div className="space-y-3">
            <Button
              type="submit"
              className="w-full h-11 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900"
              disabled={isLoading || otpCode.length !== 6}
              data-testid="button-forgot-verify"
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                "Verify Code"
              )}
            </Button>
            
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setForgotPasswordStep("email")}
                disabled={isLoading}
                data-testid="button-forgot-back"
              >
                Back
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={handleForgotPasswordResendOTP}
                disabled={isLoading || !canResendOtp}
                data-testid="button-forgot-resend"
              >
                {canResendOtp ? "Resend Code" : `Resend in ${otpTimer}s`}
              </Button>
            </div>
          </div>
        </form>
      );
    }
    
    if (forgotPasswordStep === "new-password") {
      return (
        <form onSubmit={handleResetPassword} className="space-y-4">
          <div className="text-center space-y-3 mb-6">
            <div className="flex justify-center">
              <div className="h-14 w-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <KeyRound className="h-7 w-7 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-lg">Create new password</h3>
              <p className="text-sm text-muted-foreground">
                Enter your new password below
              </p>
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="new-password">New Password</Label>
            <div className="relative">
              <Input
                id="new-password"
                type={showPassword ? "text" : "password"}
                value={resetPasswordForm.newPassword}
                onChange={(e) => setResetPasswordForm({ ...resetPasswordForm, newPassword: e.target.value })}
                required
                minLength={6}
                className="h-11 pr-10"
                data-testid="input-new-password"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-11 w-11"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm Password</Label>
            <Input
              id="confirm-password"
              type={showPassword ? "text" : "password"}
              value={resetPasswordForm.confirmPassword}
              onChange={(e) => setResetPasswordForm({ ...resetPasswordForm, confirmPassword: e.target.value })}
              required
              minLength={6}
              className="h-11"
              data-testid="input-confirm-password"
            />
          </div>
          
          <Button
            type="submit"
            className="w-full h-11 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900"
            disabled={isLoading}
            data-testid="button-reset-password"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              "Reset Password"
            )}
          </Button>
        </form>
      );
    }
    
    return null;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent hideCloseButton className="sm:max-w-[440px] p-0 gap-0 overflow-hidden rounded-2xl border shadow-2xl bg-background" data-testid="dialog-auth">
        <VisuallyHidden.Root>
          <DialogTitle>{getDialogTitle()}</DialogTitle>
          <DialogDescription>{getDialogDescription()}</DialogDescription>
        </VisuallyHidden.Root>
        
        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-background/95 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center gap-4 z-50"
            data-testid="auth-loading-overlay"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            >
              <div className="w-12 h-12 border-4 border-slate-200 dark:border-slate-700 border-t-amber-500 rounded-full" />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-center"
            >
              <p className="font-semibold text-foreground">Processing...</p>
              <p className="text-sm text-muted-foreground">Setting up your account</p>
            </motion.div>
          </motion.div>
        )}
        
        <div className="relative p-6 pb-4 border-b bg-muted/30">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            data-testid="button-close-auth"
          >
            <X className="h-5 w-5" />
          </Button>
          
          {authView === "login" ? (
            <div className="flex flex-col items-center text-center space-y-3">
              {currentLogo && (
                <img
                  src={currentLogo}
                  alt={branding.app_name}
                  className="h-10 w-auto max-w-[180px] object-contain"
                  data-testid="img-auth-logo"
                />
              )}
              <div>
                <h2 className="text-xl font-bold">Welcome back</h2>
                <p className="text-muted-foreground text-sm">
                  Sign in to manage your AI voice agents
                </p>
              </div>
            </div>
          ) : authView === "forgot-password" ? (
            <div className="space-y-1">
              <h2 className="text-xl font-bold">Reset password</h2>
              <p className="text-muted-foreground text-sm">
                {forgotPasswordStep === "email" && "Enter your email to receive a reset code"}
                {forgotPasswordStep === "otp" && "Enter the verification code"}
                {forgotPasswordStep === "new-password" && "Create your new password"}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                {currentLogo && (
                  <img
                    src={currentLogo}
                    alt={branding.app_name}
                    className="h-8 w-auto max-w-[140px] object-contain"
                    data-testid="img-auth-logo"
                  />
                )}
              </div>
              <div>
                <h2 className="text-xl font-bold">Create your account</h2>
                <p className="text-muted-foreground text-sm">
                  Get started with AI-powered calling
                </p>
              </div>
            </div>
          )}
        </div>
        
        <div className="p-6">
          {authView === "forgot-password" ? (
            renderForgotPassword()
          ) : (
            <div className="">
              <Tabs value={activeTab} onValueChange={(v) => {
                setActiveTab(v as "login" | "register");
                setAuthView(v as "login" | "register");
              }} className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-6">
                  <TabsTrigger value="login" data-testid="tab-login">Sign In</TabsTrigger>
                  <TabsTrigger value="register" data-testid="tab-register">Create Account</TabsTrigger>
                </TabsList>
                
                <TabsContent value="login" className="mt-0">
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="dialog-login-email">Email</Label>
                      <Input
                        id="dialog-login-email"
                        type="email"
                        placeholder="you@company.com"
                        value={loginForm.email}
                        onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                        required
                        className="h-11"
                        data-testid="input-dialog-login-email"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="dialog-login-password">Password</Label>
                        <button
                          type="button"
                          className="text-sm text-primary hover:underline"
                          onClick={() => {
                            setAuthView("forgot-password");
                            setForgotPasswordForm({ email: loginForm.email });
                          }}
                          data-testid="link-forgot-password"
                        >
                          Forgot password?
                        </button>
                      </div>
                      <div className="relative">
                        <Input
                          id="dialog-login-password"
                          type={showPassword ? "text" : "password"}
                          value={loginForm.password}
                          onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                          required
                          className="h-11 pr-10"
                          data-testid="input-dialog-login-password"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-11 w-11"
                          onClick={() => setShowPassword(!showPassword)}
                          data-testid="button-toggle-login-password"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <Button
                      type="submit"
                      className="w-full h-11 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900"
                      disabled={isLoading}
                      data-testid="button-dialog-login"
                    >
                      {isLoading ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <>
                          Sign In
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </form>
                </TabsContent>
                
                <TabsContent value="register" className="mt-0">
                  {signupStep === "details" ? (
                    <form onSubmit={handleSendOTP} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="dialog-register-name">Full Name</Label>
                        <Input
                          id="dialog-register-name"
                          type="text"
                          placeholder="John Doe"
                          value={registerForm.name}
                          onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
                          required
                          className="h-11"
                          data-testid="input-dialog-register-name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="dialog-register-email">Email</Label>
                        <Input
                          id="dialog-register-email"
                          type="email"
                          placeholder="you@company.com"
                          value={registerForm.email}
                          onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })}
                          required
                          className="h-11"
                          data-testid="input-dialog-register-email"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="dialog-register-password">Password</Label>
                        <div className="relative">
                          <Input
                            id="dialog-register-password"
                            type={showPassword ? "text" : "password"}
                            value={registerForm.password}
                            onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
                            required
                            minLength={6}
                            className="h-11 pr-10"
                            data-testid="input-dialog-register-password"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-0 top-0 h-11 w-11"
                            onClick={() => setShowPassword(!showPassword)}
                            data-testid="button-toggle-register-password"
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                      
                      <div className="flex items-start space-x-2">
                        <Checkbox
                          id="accept-terms"
                          checked={registerForm.acceptedTerms}
                          onCheckedChange={(checked) => 
                            setRegisterForm({ ...registerForm, acceptedTerms: checked === true })
                          }
                          className="mt-0.5"
                          data-testid="checkbox-accept-terms"
                        />
                        <label
                          htmlFor="accept-terms"
                          className="text-sm text-muted-foreground leading-relaxed cursor-pointer"
                        >
                          I agree to the{" "}
                          <Link href="/terms" className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                            Terms of Service
                          </Link>{" "}
                          and{" "}
                          <Link href="/privacy" className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                            Privacy Policy
                          </Link>
                        </label>
                      </div>
                      
                      <Button
                        type="submit"
                        className="w-full h-11 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900"
                        disabled={isLoading || !registerForm.acceptedTerms}
                        data-testid="button-dialog-send-otp"
                      >
                        {isLoading ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <>
                            Continue with Email
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </>
                        )}
                      </Button>
                    </form>
                  ) : (
                    <form onSubmit={handleVerifyOTP} className="space-y-6">
                      <div className="text-center space-y-3">
                        <div className="flex justify-center">
                          <div className="h-14 w-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                            <Mail className="h-7 w-7 text-slate-600 dark:text-slate-300" />
                          </div>
                        </div>
                        <div>
                          <h3 className="font-semibold text-lg">Check your email</h3>
                          <p className="text-sm text-muted-foreground">
                            We sent a code to <strong className="text-foreground">{registerForm.email}</strong>
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex justify-center">
                        <InputOTP
                          maxLength={6}
                          value={otpCode}
                          onChange={setOtpCode}
                          data-testid="input-dialog-otp"
                        >
                          <InputOTPGroup>
                            <InputOTPSlot index={0} />
                            <InputOTPSlot index={1} />
                            <InputOTPSlot index={2} />
                            <InputOTPSlot index={3} />
                            <InputOTPSlot index={4} />
                            <InputOTPSlot index={5} />
                          </InputOTPGroup>
                        </InputOTP>
                      </div>
                      
                      {otpTimer > 0 && (
                        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                          <AlertCircle className="h-4 w-4" />
                          <span>Code expires in {Math.floor(otpTimer / 60)}:{String(otpTimer % 60).padStart(2, "0")}</span>
                        </div>
                      )}
                      
                      <div className="space-y-3">
                        <Button
                          type="submit"
                          className="w-full h-11 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-900"
                          disabled={isLoading || otpCode.length !== 6}
                          data-testid="button-dialog-verify"
                        >
                          {isLoading ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            "Verify & Create Account"
                          )}
                        </Button>
                        
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="flex-1"
                            onClick={() => setSignupStep("details")}
                            disabled={isLoading}
                            data-testid="button-dialog-back"
                          >
                            Back
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="flex-1"
                            onClick={handleResendOTP}
                            disabled={isLoading || !canResendOtp}
                            data-testid="button-dialog-resend"
                          >
                            {canResendOtp ? "Resend Code" : `Resend in ${otpTimer}s`}
                          </Button>
                        </div>
                      </div>
                    </form>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AuthDialogProvider;
