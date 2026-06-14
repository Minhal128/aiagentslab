/**
 * ============================================================
 * LoginPage - Full Page Login/Register with Informative Left Panel
 * Includes inline Forgot Password flow
 * ============================================================
 */
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useBranding } from "@/components/BrandingProvider";
import { apiRequest } from "@/lib/queryClient";
import { AuthStorage } from "@/lib/auth-storage";
import { AILoadingAnimation } from "@/components/landing/AILoadingAnimation";
import { 
  ArrowLeft, Eye, EyeOff, Check, 
  Bot, Layers, Brain, Zap, Mail, KeyRound
} from "lucide-react";
import { Link } from "wouter";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email"),
});

const resetPasswordSchema = z.object({
  otp: z.string().min(6, "OTP must be 6 digits"),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type LoginFormData = z.infer<typeof loginSchema>;
type RegisterFormData = z.infer<typeof registerSchema>;
type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;
type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

type ViewType = "login" | "register" | "register-otp" | "forgot-password" | "reset-password";

const features = [
  {
    icon: Bot,
    title: "AI Agent Templates",
    description: "Deploy your Agent in minutes!"
  },
  {
    icon: Layers,
    title: "Custom Agents",
    description: "Design agents on Voice, SMS with no-code Agent Studio."
  },
  {
    icon: Brain,
    title: "Context-aware Agents",
    description: "1-click integrations to your FAQs, product catalogs, policies."
  },
  {
    icon: Zap,
    title: "Instant Updates",
    description: "Agents sync to your systems using powerful integrations."
  }
];

const stats = [
  { value: "100+", label: "Countries" },
  { value: "30+", label: "Languages" },
  { value: "99.9%", label: "Uptime" },
  { value: "24/7", label: "Support" }
];

export default function LoginPage() {
  const [location, setLocation] = useLocation();
  const initialTab = location === "/register" ? "register" : "login";
  const [activeView, setActiveView] = useState<ViewType>(initialTab);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showLoadingAnimation, setShowLoadingAnimation] = useState(false);
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState<string>("");
  const [otpTimer, setOtpTimer] = useState(0);
  const [registerOtpCode, setRegisterOtpCode] = useState<string>("");
  const [canResendOtp, setCanResendOtp] = useState(false);
  const { toast } = useToast();
  const { branding, currentLogo } = useBranding();

  // OTP timer countdown
  useEffect(() => {
    if (otpTimer > 0) {
      const timer = setTimeout(() => setOtpTimer(otpTimer - 1), 1000);
      return () => clearTimeout(timer);
    } else if (otpTimer === 0 && (activeView === 'register-otp' || activeView === 'reset-password')) {
      setCanResendOtp(true);
    }
  }, [otpTimer, activeView]);

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const registerForm = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  const forgotPasswordForm = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const resetPasswordForm = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { otp: "", newPassword: "", confirmPassword: "" },
  });

  const handleLoadingComplete = () => {
    // Navigate using SPA routing - don't hide the loader first
    // The component will unmount naturally when navigation completes
    if (pendingRedirect) {
      setLocation(pendingRedirect);
    }
  };

  const handleLogin = async (data: LoginFormData) => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Login failed");
      }

      AuthStorage.setAuthData(result.token, result.user, result.refreshToken, result.expiresIn);
      setUserName(result.user.name || result.user.email.split('@')[0]);
      
      toast({ title: "Welcome back!", description: "Login successful" });

      // Show loading animation then redirect based on user role
      const redirectPath = (result.user.role === 'admin' || result.user.role === 'super_admin') ? "/admin" : "/app";
      setPendingRedirect(redirectPath);
      setShowLoadingAnimation(true);
    } catch (error: any) {
      toast({ title: "Login failed", description: error.message || "Invalid credentials", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  // Step 1: Send OTP for registration
  const handleSendRegistrationOTP = async (data: RegisterFormData) => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.email,
          name: data.name,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to send verification code");
      }

      toast({
        title: "Code sent!",
        description: `Check your email at ${data.email}`,
      });

      setActiveView('register-otp');
      setOtpTimer(300); // 5 minutes countdown
      setCanResendOtp(false);
      setRegisterOtpCode("");
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

  // Resend OTP for registration
  const handleResendRegistrationOTP = async () => {
    const data = registerForm.getValues();
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.email,
          name: data.name,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to resend verification code");
      }

      toast({
        title: "Code resent!",
        description: "A new verification code has been sent to your email",
      });

      setOtpTimer(300);
      setCanResendOtp(false);
      setRegisterOtpCode("");
    } catch (error: any) {
      toast({
        title: "Failed to resend code",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: Verify OTP and complete registration
  const handleVerifyAndRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (registerOtpCode.length !== 6) {
      toast({ title: "Invalid code", description: "Please enter a 6-digit code", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      // First verify the OTP
      const verifyResponse = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: registerForm.getValues().email,
          otpCode: registerOtpCode,
        }),
      });

      const verifyResult = await verifyResponse.json();

      if (!verifyResponse.ok) {
        throw new Error(verifyResult.error || "Invalid verification code");
      }

      // OTP verified successfully, now complete registration
      const registerData = registerForm.getValues();
      const registerResponse = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: registerData.email,
          password: registerData.password,
          name: registerData.name,
        }),
      });

      const result = await registerResponse.json();

      if (!registerResponse.ok) {
        throw new Error(result.error || "Registration failed");
      }

      AuthStorage.setAuthData(result.token, result.user, result.refreshToken, result.expiresIn);
      setUserName(result.user.name || result.user.email.split('@')[0]);
      
      toast({
        title: "Account created!",
        description: `Welcome, ${result.user.name}`,
      });

      // Show loading animation then redirect based on user role
      const redirectPath = result.user.role === 'admin' ? "/admin" : "/app";
      setPendingRedirect(redirectPath);
      setShowLoadingAnimation(true);
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

  const handleBackToRegisterDetails = () => {
    setActiveView('register');
    setRegisterOtpCode("");
    setOtpTimer(0);
    setCanResendOtp(false);
  };

  const handleForgotPasswordSubmit = async (data: ForgotPasswordFormData) => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/forgot-password/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email }),
      });
      const result = await response.json();
      
      if (response.ok) {
        setForgotPasswordEmail(data.email);
        setOtpTimer(300);
        setCanResendOtp(false);
        setActiveView("reset-password");
        toast({ title: "Code sent!", description: "Check your email for the verification code" });
      } else {
        toast({ title: "Failed to send code", description: result.error || "Something went wrong", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Failed to send code", description: error.message || "Something went wrong", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendForgotPasswordOTP = async () => {
    if (otpTimer > 0) return;
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/forgot-password/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotPasswordEmail }),
      });
      const result = await response.json();
      
      if (response.ok) {
        setOtpTimer(300);
        setCanResendOtp(false);
        toast({ title: "Code resent!", description: "Check your email for the new code" });
      } else {
        toast({ title: "Failed to resend", description: result.error || "Something went wrong", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Failed to resend", description: error.message || "Something went wrong", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (data: ResetPasswordFormData) => {
    setIsLoading(true);
    try {
      // First verify OTP
      const verifyResponse = await fetch("/api/auth/forgot-password/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotPasswordEmail, otpCode: data.otp }),
      });
      const verifyResult = await verifyResponse.json();
      
      if (!verifyResponse.ok) {
        toast({ title: "Invalid code", description: verifyResult.error || "Please check the code and try again", variant: "destructive" });
        setIsLoading(false);
        return;
      }

      // Then reset password
      const resetResponse = await fetch("/api/auth/forgot-password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          email: forgotPasswordEmail, 
          newPassword: data.newPassword 
        }),
      });
      const resetResult = await resetResponse.json();
      
      if (resetResponse.ok) {
        toast({ title: "Password reset!", description: "You can now login with your new password" });
        resetPasswordForm.reset();
        forgotPasswordForm.reset();
        setActiveView("login");
      } else {
        toast({ title: "Failed to reset password", description: resetResult.error || "Something went wrong", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Failed to reset password", description: error.message || "Something went wrong", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const getCardTitle = () => {
    switch (activeView) {
      case "login": return "Welcome back";
      case "register": return "Create account";
      case "register-otp": return "Verify email";
      case "forgot-password": return "Forgot password?";
      case "reset-password": return "Reset password";
    }
  };

  const getCardDescription = () => {
    switch (activeView) {
      case "login": return "Sign in to continue to your dashboard";
      case "register": return "Get started with your free account";
      case "register-otp": return `Enter the code sent to ${registerForm.getValues().email}`;
      case "forgot-password": return "Enter your email to receive a reset code";
      case "reset-password": return `Enter the code sent to ${forgotPasswordEmail}`;
    }
  };

  return (
    <>
      <AILoadingAnimation 
        isVisible={showLoadingAnimation} 
        onComplete={handleLoadingComplete}
        userName={userName}
      />
      
      <div className="min-h-screen flex" data-testid="login-page">
        {/* Left side - Informative Panel */}
        <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-[#050B1A] via-[#0a1628] to-[#050B1A] relative overflow-hidden">
          {/* Animated background elements */}
          <div className="absolute inset-0">
            <div className="absolute top-20 left-10 w-72 h-72 bg-brand/10 rounded-full blur-3xl" />
            <div className="absolute bottom-20 right-10 w-96 h-96 bg-brand/5 rounded-full blur-3xl" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-brand/5 rounded-full blur-3xl" />
          </div>
          
          <div className="relative z-10 flex flex-col justify-between p-12 w-full">
            {/* Logo - Use white logo (logo_url_dark) for dark background */}
            <Link href="/">
              <div className="flex items-center gap-3 cursor-pointer" data-testid="link-logo">
                {branding.logo_url_dark && (
                  <img src={branding.logo_url_dark} alt={branding.app_name} className="h-10" />
                )}
              </div>
            </Link>
            
            {/* Main Content */}
            <div className="space-y-10">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
              >
                <h1 className="text-4xl xl:text-5xl font-bold leading-tight text-white mb-4">
                  Launch AI agents & automate your customer interactions
                </h1>
              </motion.div>
              
              {/* Features List */}
              <motion.div 
                className="space-y-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                {features.map((feature, index) => (
                  <motion.div 
                    key={index}
                    className="flex items-start gap-4"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4, delay: 0.3 + index * 0.1 }}
                    data-testid={`feature-item-${index}`}
                  >
                    <div className="w-10 h-10 rounded-lg bg-brand/20 border border-brand/30 flex items-center justify-center shrink-0">
                      <feature.icon className="w-5 h-5 text-brand" />
                    </div>
                    <div>
                      <p className="text-white">
                        Access pre-built <span className="font-semibold">{feature.title}</span>.{" "}
                        <span className="text-gray-400">{feature.description}</span>
                      </p>
                    </div>
                  </motion.div>
                ))}
              </motion.div>

              {/* Stats Row */}
              <motion.div
                className="pt-8 border-t border-white/10"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.6 }}
              >
                <div className="grid grid-cols-4 gap-6">
                  {stats.map((stat, index) => (
                    <div key={index} className="text-center" data-testid={`stat-${index}`}>
                      <div className="text-2xl font-bold text-brand">{stat.value}</div>
                      <div className="text-sm text-gray-400">{stat.label}</div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
            
            {/* Footer */}
            <p className="text-sm text-gray-500">
              &copy; {new Date().getFullYear()} {branding.app_name}. All rights reserved.
            </p>
          </div>
        </div>

        {/* Right side - Login Form */}
        <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-gray-50 dark:bg-[#0a1628]">
          <div className="w-full max-w-md space-y-6">
            {/* Mobile back button */}
            <div className="lg:hidden">
              <Link href="/">
                <Button variant="ghost" size="sm" className="mb-4" data-testid="button-back-home">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to home
                </Button>
              </Link>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              key={activeView}
            >
              <Card className="border border-gray-200 dark:border-brand/20 shadow-2xl shadow-gray-200/50 dark:shadow-brand/10 bg-white dark:bg-[#0f1d32]">
                <CardHeader className="text-center pb-2">
                  {/* Mobile logo */}
                  <div className="lg:hidden flex justify-center mb-4">
                    {currentLogo && (
                      <img src={currentLogo} alt={branding.app_name} className="h-10" />
                    )}
                  </div>
                  
                  {/* Icon for forgot/reset password views */}
                  {(activeView === "forgot-password" || activeView === "reset-password") && (
                    <div className="flex justify-center mb-4">
                      <div className="w-16 h-16 rounded-full bg-brand/10 border border-brand/30 flex items-center justify-center">
                        {activeView === "forgot-password" ? (
                          <Mail className="w-8 h-8 text-brand" />
                        ) : (
                          <KeyRound className="w-8 h-8 text-brand" />
                        )}
                      </div>
                    </div>
                  )}
                  
                  <CardTitle className="text-2xl font-bold text-gray-900 dark:text-white">
                    {getCardTitle()}
                  </CardTitle>
                  <CardDescription className="text-gray-600 dark:text-gray-400">
                    {getCardDescription()}
                  </CardDescription>
                </CardHeader>
                
                <CardContent className="pt-4">
                  {/* Login/Register Tabs */}
                  {(activeView === "login" || activeView === "register") && (
                    <Tabs value={activeView} onValueChange={(v) => setActiveView(v as ViewType)}>
                      <TabsList className="grid w-full grid-cols-2 mb-6 bg-gray-100 dark:bg-[#0a1628]">
                        <TabsTrigger 
                          value="login" 
                          data-testid="tab-login"
                          className="data-[state=active]:bg-white dark:data-[state=active]:bg-brand data-[state=active]:text-gray-900 dark:data-[state=active]:text-brand-foreground"
                        >
                          Sign In
                        </TabsTrigger>
                        <TabsTrigger 
                          value="register" 
                          data-testid="tab-register"
                          className="data-[state=active]:bg-white dark:data-[state=active]:bg-brand data-[state=active]:text-gray-900 dark:data-[state=active]:text-brand-foreground"
                        >
                          Sign Up
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="login">
                        <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="login-email" className="text-gray-700 dark:text-gray-300">Email</Label>
                            <Input
                              id="login-email"
                              type="email"
                              placeholder="you@example.com"
                              className="h-12 bg-gray-50 dark:bg-[#0a1628] border-gray-200 dark:border-brand/20 focus:border-brand dark:focus:border-brand"
                              {...loginForm.register("email")}
                              data-testid="input-login-email"
                            />
                            {loginForm.formState.errors.email && (
                              <p className="text-sm text-destructive">{loginForm.formState.errors.email.message}</p>
                            )}
                          </div>
                          
                          <div className="space-y-2">
                            <Label htmlFor="login-password" className="text-gray-700 dark:text-gray-300">Password</Label>
                            <div className="relative">
                              <Input
                                id="login-password"
                                type={showPassword ? "text" : "password"}
                                placeholder="Enter your password"
                                className="h-12 bg-gray-50 dark:bg-[#0a1628] border-gray-200 dark:border-brand/20 focus:border-brand dark:focus:border-brand pr-12"
                                {...loginForm.register("password")}
                                data-testid="input-login-password"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="absolute right-0 top-0 h-full text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                onClick={() => setShowPassword(!showPassword)}
                                data-testid="button-toggle-password"
                              >
                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </Button>
                            </div>
                            {loginForm.formState.errors.password && (
                              <p className="text-sm text-destructive">{loginForm.formState.errors.password.message}</p>
                            )}
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={() => {
                                  forgotPasswordForm.setValue("email", loginForm.getValues("email"));
                                  setActiveView("forgot-password");
                                }}
                                className="text-sm text-brand hover:underline cursor-pointer"
                                data-testid="link-forgot-password"
                              >
                                Forgot password?
                              </button>
                            </div>
                          </div>

                          <Button
                            type="submit"
                            className="w-full h-12 bg-brand text-brand-foreground font-medium border-0 shadow-lg shadow-brand/25"
                            disabled={isLoading}
                            data-testid="button-login-submit"
                          >
                            {isLoading ? "Signing in..." : "Sign In"}
                          </Button>
                        </form>
                      </TabsContent>

                      <TabsContent value="register">
                        <form onSubmit={registerForm.handleSubmit(handleSendRegistrationOTP)} className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="register-name" className="text-gray-700 dark:text-gray-300">Full Name</Label>
                            <Input
                              id="register-name"
                              type="text"
                              placeholder="John Doe"
                              className="h-12 bg-gray-50 dark:bg-[#0a1628] border-gray-200 dark:border-brand/20 focus:border-brand dark:focus:border-brand"
                              {...registerForm.register("name")}
                              data-testid="input-register-name"
                            />
                            {registerForm.formState.errors.name && (
                              <p className="text-sm text-destructive">{registerForm.formState.errors.name.message}</p>
                            )}
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="register-email" className="text-gray-700 dark:text-gray-300">Email</Label>
                            <Input
                              id="register-email"
                              type="email"
                              placeholder="you@example.com"
                              className="h-12 bg-gray-50 dark:bg-[#0a1628] border-gray-200 dark:border-brand/20 focus:border-brand dark:focus:border-brand"
                              {...registerForm.register("email")}
                              data-testid="input-register-email"
                            />
                            {registerForm.formState.errors.email && (
                              <p className="text-sm text-destructive">{registerForm.formState.errors.email.message}</p>
                            )}
                          </div>
                          
                          <div className="space-y-2">
                            <Label htmlFor="register-password" className="text-gray-700 dark:text-gray-300">Password</Label>
                            <div className="relative">
                              <Input
                                id="register-password"
                                type={showPassword ? "text" : "password"}
                                placeholder="Create a password"
                                className="h-12 bg-gray-50 dark:bg-[#0a1628] border-gray-200 dark:border-brand/20 focus:border-brand dark:focus:border-brand pr-12"
                                {...registerForm.register("password")}
                                data-testid="input-register-password"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="absolute right-0 top-0 h-full text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                onClick={() => setShowPassword(!showPassword)}
                              >
                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </Button>
                            </div>
                            {registerForm.formState.errors.password && (
                              <p className="text-sm text-destructive">{registerForm.formState.errors.password.message}</p>
                            )}
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="register-confirm" className="text-gray-700 dark:text-gray-300">Confirm Password</Label>
                            <Input
                              id="register-confirm"
                              type="password"
                              placeholder="Confirm your password"
                              className="h-12 bg-gray-50 dark:bg-[#0a1628] border-gray-200 dark:border-brand/20 focus:border-brand dark:focus:border-brand"
                              {...registerForm.register("confirmPassword")}
                              data-testid="input-register-confirm"
                            />
                            {registerForm.formState.errors.confirmPassword && (
                              <p className="text-sm text-destructive">{registerForm.formState.errors.confirmPassword.message}</p>
                            )}
                          </div>

                          <Button
                            type="submit"
                            className="w-full h-12 bg-brand text-brand-foreground font-medium border-0 shadow-lg shadow-brand/25"
                            disabled={isLoading}
                            data-testid="button-register-submit"
                          >
                            {isLoading ? "Sending code..." : "Send Verification Code"}
                          </Button>
                        </form>
                      </TabsContent>
                    </Tabs>
                  )}

                  {/* Registration OTP Verification */}
                  {activeView === "register-otp" && (
                    <form onSubmit={handleVerifyAndRegister} className="space-y-4">
                      <div className="text-center space-y-2 mb-4">
                        <div className="flex justify-center mb-4">
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/10">
                            <Mail className="h-6 w-6 text-brand" />
                          </div>
                        </div>
                        <h3 className="font-semibold text-lg text-gray-900 dark:text-white">Check your email</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          We sent a verification code to<br />
                          <strong className="text-gray-700 dark:text-gray-200">{registerForm.getValues().email}</strong>
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="register-otp" className="text-gray-700 dark:text-gray-300">Verification Code</Label>
                        <Input
                          id="register-otp"
                          type="text"
                          placeholder="Enter 6-digit code"
                          maxLength={6}
                          value={registerOtpCode}
                          onChange={(e) => setRegisterOtpCode(e.target.value.replace(/\D/g, ''))}
                          className="h-12 bg-gray-50 dark:bg-[#0a1628] border-gray-200 dark:border-brand/20 focus:border-brand dark:focus:border-brand text-center text-lg tracking-widest"
                          data-testid="input-register-otp"
                        />
                        {otpTimer > 0 && (
                          <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                            <span>Code expires in {Math.floor(otpTimer / 60)}:{String(otpTimer % 60).padStart(2, '0')}</span>
                          </div>
                        )}
                      </div>

                      <Button
                        type="submit"
                        className="w-full h-12 bg-brand text-brand-foreground font-medium border-0 shadow-lg shadow-brand/25"
                        disabled={isLoading || registerOtpCode.length !== 6}
                        data-testid="button-verify-register"
                      >
                        {isLoading ? "Verifying..." : "Verify & Create Account"}
                      </Button>

                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1"
                          onClick={handleBackToRegisterDetails}
                          disabled={isLoading}
                          data-testid="button-back-register"
                        >
                          <ArrowLeft className="w-4 h-4 mr-2" />
                          Back
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1"
                          onClick={handleResendRegistrationOTP}
                          disabled={isLoading || !canResendOtp}
                          data-testid="button-resend-register-otp"
                        >
                          {canResendOtp ? "Resend Code" : `Resend in ${Math.floor(otpTimer / 60)}:${String(otpTimer % 60).padStart(2, '0')}`}
                        </Button>
                      </div>
                    </form>
                  )}

                  {/* Forgot Password Form */}
                  {activeView === "forgot-password" && (
                    <form onSubmit={forgotPasswordForm.handleSubmit(handleForgotPasswordSubmit)} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="forgot-email" className="text-gray-700 dark:text-gray-300">Email</Label>
                        <Input
                          id="forgot-email"
                          type="email"
                          placeholder="you@example.com"
                          className="h-12 bg-gray-50 dark:bg-[#0a1628] border-gray-200 dark:border-brand/20 focus:border-brand dark:focus:border-brand"
                          {...forgotPasswordForm.register("email")}
                          data-testid="input-forgot-email"
                        />
                        {forgotPasswordForm.formState.errors.email && (
                          <p className="text-sm text-destructive">{forgotPasswordForm.formState.errors.email.message}</p>
                        )}
                      </div>

                      <Button
                        type="submit"
                        className="w-full h-12 bg-brand text-brand-foreground font-medium border-0 shadow-lg shadow-brand/25"
                        disabled={isLoading}
                        data-testid="button-send-code"
                      >
                        {isLoading ? "Sending..." : "Send Reset Code"}
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        className="w-full"
                        onClick={() => setActiveView("login")}
                        data-testid="button-back-to-login"
                      >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to login
                      </Button>
                    </form>
                  )}

                  {/* Reset Password Form */}
                  {activeView === "reset-password" && (
                    <form onSubmit={resetPasswordForm.handleSubmit(handleResetPassword)} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="reset-otp" className="text-gray-700 dark:text-gray-300">Verification Code</Label>
                        <Input
                          id="reset-otp"
                          type="text"
                          placeholder="Enter 6-digit code"
                          maxLength={6}
                          className="h-12 bg-gray-50 dark:bg-[#0a1628] border-gray-200 dark:border-brand/20 focus:border-brand dark:focus:border-brand text-center text-lg tracking-widest"
                          {...resetPasswordForm.register("otp")}
                          data-testid="input-reset-otp"
                        />
                        {resetPasswordForm.formState.errors.otp && (
                          <p className="text-sm text-destructive">{resetPasswordForm.formState.errors.otp.message}</p>
                        )}
                        <div className="flex justify-center">
                          {otpTimer > 0 ? (
                            <span className="text-sm text-gray-500">Resend code in {Math.floor(otpTimer / 60)}:{String(otpTimer % 60).padStart(2, '0')}</span>
                          ) : (
                            <button
                              type="button"
                              onClick={handleResendForgotPasswordOTP}
                              className="text-sm text-brand hover:underline"
                              disabled={isLoading}
                              data-testid="button-resend-otp"
                            >
                              Resend code
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="reset-password" className="text-gray-700 dark:text-gray-300">New Password</Label>
                        <div className="relative">
                          <Input
                            id="reset-password"
                            type={showPassword ? "text" : "password"}
                            placeholder="Create a new password"
                            className="h-12 bg-gray-50 dark:bg-[#0a1628] border-gray-200 dark:border-brand/20 focus:border-brand dark:focus:border-brand pr-12"
                            {...resetPasswordForm.register("newPassword")}
                            data-testid="input-reset-password"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-0 top-0 h-full text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                            onClick={() => setShowPassword(!showPassword)}
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </div>
                        {resetPasswordForm.formState.errors.newPassword && (
                          <p className="text-sm text-destructive">{resetPasswordForm.formState.errors.newPassword.message}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="reset-confirm" className="text-gray-700 dark:text-gray-300">Confirm New Password</Label>
                        <Input
                          id="reset-confirm"
                          type="password"
                          placeholder="Confirm your new password"
                          className="h-12 bg-gray-50 dark:bg-[#0a1628] border-gray-200 dark:border-brand/20 focus:border-brand dark:focus:border-brand"
                          {...resetPasswordForm.register("confirmPassword")}
                          data-testid="input-reset-confirm"
                        />
                        {resetPasswordForm.formState.errors.confirmPassword && (
                          <p className="text-sm text-destructive">{resetPasswordForm.formState.errors.confirmPassword.message}</p>
                        )}
                      </div>

                      <Button
                        type="submit"
                        className="w-full h-12 bg-brand text-brand-foreground font-medium border-0 shadow-lg shadow-brand/25"
                        disabled={isLoading}
                        data-testid="button-reset-password"
                      >
                        {isLoading ? "Resetting..." : "Reset Password"}
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        className="w-full"
                        onClick={() => {
                          setActiveView("forgot-password");
                          resetPasswordForm.reset();
                        }}
                        data-testid="button-back-to-email"
                      >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Change email
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Terms */}
            <p className="text-center text-sm text-gray-500 dark:text-gray-400">
              By continuing, you agree to our{" "}
              <Link href="/terms" className="text-brand hover:underline">Terms of Service</Link>
              {" "}and{" "}
              <Link href="/privacy" className="text-brand hover:underline">Privacy Policy</Link>
            </p>

            {/* Trust indicators */}
            <motion.div
              className="flex items-center justify-center gap-6 pt-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
            >
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Check className="w-4 h-4 text-brand" />
                <span>14-day free trial</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Check className="w-4 h-4 text-brand" />
                <span>No credit card</span>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </>
  );
}
