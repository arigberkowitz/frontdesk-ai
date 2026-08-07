"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { useSignIn, useSignUp } from "@clerk/nextjs/legacy";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { cn } from "@/lib/utils";
import { Canvas, useFrame, useThree } from "@react-three/fiber";

import * as THREE from "three";

/* eslint-disable @typescript-eslint/no-explicit-any -- three.js / WebGL shader interop is loosely typed */

// "/" lets the server route each role to its home (operator → /dashboard,
// client → /portal, fresh signup → /welcome) without a flash of the wrong shell.
const AFTER_AUTH_URL = "/";
const SSO_CALLBACK_URL = "/sign-in/sso-callback";

type Uniforms = {
  [key: string]: {
    value: number[] | number[][] | number;
    type: string;
  };
};

interface ShaderProps {
  source: string;
  uniforms: {
    [key: string]: {
      value: number[] | number[][] | number;
      type: string;
    };
  };
  maxFps?: number;
}

interface SignInPageProps {
  className?: string;
}

export const CanvasRevealEffect = ({
  animationSpeed = 10,
  opacities = [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1],
  colors = [[0, 255, 255]],
  containerClassName,
  dotSize,
  showGradient = true,
  reverse = false,
}: {
  animationSpeed?: number;
  opacities?: number[];
  colors?: number[][];
  containerClassName?: string;
  dotSize?: number;
  showGradient?: boolean;
  reverse?: boolean;
}) => {
  return (
    <div className={cn("h-full relative w-full", containerClassName)}>
      <div className="h-full w-full">
        <DotMatrix
          colors={colors ?? [[0, 255, 255]]}
          dotSize={dotSize ?? 3}
          opacities={opacities ?? [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1]}
          shader={`
            ${reverse ? "u_reverse_active" : "false"}_;
            animation_speed_factor_${animationSpeed.toFixed(1)}_;
          `}
          center={["x", "y"]}
        />
      </div>
      {showGradient && (
        // White theme: fade the matrix into the page background instead of black.
        <div className="absolute inset-0 bg-gradient-to-t from-white to-transparent" />
      )}
    </div>
  );
};

interface DotMatrixProps {
  colors?: number[][];
  opacities?: number[];
  totalSize?: number;
  dotSize?: number;
  shader?: string;
  center?: ("x" | "y")[];
}

const DotMatrix: React.FC<DotMatrixProps> = ({
  colors = [[0, 0, 0]],
  opacities = [0.04, 0.04, 0.04, 0.04, 0.04, 0.08, 0.08, 0.08, 0.08, 0.14],
  totalSize = 20,
  dotSize = 2,
  shader = "",
  center = ["x", "y"],
}) => {
  const uniforms = React.useMemo(() => {
    let colorsArray = [colors[0], colors[0], colors[0], colors[0], colors[0], colors[0]];
    if (colors.length === 2) {
      colorsArray = [colors[0], colors[0], colors[0], colors[1], colors[1], colors[1]];
    } else if (colors.length === 3) {
      colorsArray = [colors[0], colors[0], colors[1], colors[1], colors[2], colors[2]];
    }
    return {
      u_colors: {
        value: colorsArray.map((color) => [color[0] / 255, color[1] / 255, color[2] / 255]),
        type: "uniform3fv",
      },
      u_opacities: {
        value: opacities,
        type: "uniform1fv",
      },
      u_total_size: {
        value: totalSize,
        type: "uniform1f",
      },
      u_dot_size: {
        value: dotSize,
        type: "uniform1f",
      },
      u_reverse: {
        value: shader.includes("u_reverse_active") ? 1 : 0,
        type: "uniform1i",
      },
    };
  }, [colors, opacities, totalSize, dotSize, shader]);

  return (
    <Shader
      source={`
        precision mediump float;
        in vec2 fragCoord;

        uniform float u_time;
        uniform float u_opacities[10];
        uniform vec3 u_colors[6];
        uniform float u_total_size;
        uniform float u_dot_size;
        uniform vec2 u_resolution;
        uniform int u_reverse;

        out vec4 fragColor;

        float PHI = 1.61803398874989484820459;
        float random(vec2 xy) {
            return fract(tan(distance(xy * PHI, xy) * 0.5) * xy.x);
        }
        float map(float value, float min1, float max1, float min2, float max2) {
            return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
        }

        void main() {
            vec2 st = fragCoord.xy;
            ${
              center.includes("x")
                ? "st.x -= abs(floor((mod(u_resolution.x, u_total_size) - u_dot_size) * 0.5));"
                : ""
            }
            ${
              center.includes("y")
                ? "st.y -= abs(floor((mod(u_resolution.y, u_total_size) - u_dot_size) * 0.5));"
                : ""
            }

            float opacity = step(0.0, st.x);
            opacity *= step(0.0, st.y);

            vec2 st2 = vec2(int(st.x / u_total_size), int(st.y / u_total_size));

            float frequency = 5.0;
            float show_offset = random(st2);
            float rand = random(st2 * floor((u_time / frequency) + show_offset + frequency));
            opacity *= u_opacities[int(rand * 10.0)];
            opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.x / u_total_size));
            opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.y / u_total_size));

            vec3 color = u_colors[int(show_offset * 6.0)];

            float animation_speed_factor = 0.5;
            vec2 center_grid = u_resolution / 2.0 / u_total_size;
            float dist_from_center = distance(center_grid, st2);

            float timing_offset_intro = dist_from_center * 0.01 + (random(st2) * 0.15);

            float max_grid_dist = distance(center_grid, vec2(0.0, 0.0));
            float timing_offset_outro = (max_grid_dist - dist_from_center) * 0.02 + (random(st2 + 42.0) * 0.2);

            float current_timing_offset;
            if (u_reverse == 1) {
                current_timing_offset = timing_offset_outro;
                 opacity *= 1.0 - step(current_timing_offset, u_time * animation_speed_factor);
                 opacity *= clamp((step(current_timing_offset + 0.1, u_time * animation_speed_factor)) * 1.25, 1.0, 1.25);
            } else {
                current_timing_offset = timing_offset_intro;
                 opacity *= step(current_timing_offset, u_time * animation_speed_factor);
                 opacity *= clamp((1.0 - step(current_timing_offset + 0.1, u_time * animation_speed_factor)) * 1.25, 1.0, 1.25);
            }

            fragColor = vec4(color, opacity);
            fragColor.rgb *= fragColor.a;
        }`}
      uniforms={uniforms}
      maxFps={60}
    />
  );
};

const ShaderMaterial = ({
  source,
  uniforms,
}: {
  source: string;
  hovered?: boolean;
  maxFps?: number;
  uniforms: Uniforms;
}) => {
  const { size } = useThree();
  const ref = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const timestamp = clock.getElapsedTime();

    const material: any = ref.current.material;
    const timeLocation = material.uniforms.u_time;
    timeLocation.value = timestamp;
  });

  const getUniforms = () => {
    const preparedUniforms: any = {};

    for (const uniformName in uniforms) {
      const uniform: any = uniforms[uniformName];

      switch (uniform.type) {
        case "uniform1f":
          preparedUniforms[uniformName] = { value: uniform.value, type: "1f" };
          break;
        case "uniform1i":
          preparedUniforms[uniformName] = { value: uniform.value, type: "1i" };
          break;
        case "uniform3f":
          preparedUniforms[uniformName] = {
            value: new THREE.Vector3().fromArray(uniform.value),
            type: "3f",
          };
          break;
        case "uniform1fv":
          preparedUniforms[uniformName] = { value: uniform.value, type: "1fv" };
          break;
        case "uniform3fv":
          preparedUniforms[uniformName] = {
            value: uniform.value.map((v: number[]) => new THREE.Vector3().fromArray(v)),
            type: "3fv",
          };
          break;
        case "uniform2f":
          preparedUniforms[uniformName] = {
            value: new THREE.Vector2().fromArray(uniform.value),
            type: "2f",
          };
          break;
        default:
          console.error(`Invalid uniform type for '${uniformName}'.`);
          break;
      }
    }

    preparedUniforms["u_time"] = { value: 0, type: "1f" };
    preparedUniforms["u_resolution"] = {
      value: new THREE.Vector2(size.width * 2, size.height * 2),
    };
    return preparedUniforms;
  };

  const material = useMemo(() => {
    const materialObject = new THREE.ShaderMaterial({
      vertexShader: `
      precision mediump float;
      in vec2 coordinates;
      uniform vec2 u_resolution;
      out vec2 fragCoord;
      void main(){
        float x = position.x;
        float y = position.y;
        gl_Position = vec4(x, y, 0.0, 1.0);
        fragCoord = (position.xy + vec2(1.0)) * 0.5 * u_resolution;
        fragCoord.y = u_resolution.y - fragCoord.y;
      }
      `,
      fragmentShader: source,
      uniforms: getUniforms(),
      glslVersion: THREE.GLSL3,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
    });

    return materialObject;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height, source]);

  return (
    <mesh ref={ref as any}>
      <planeGeometry args={[2, 2]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
};

const Shader: React.FC<ShaderProps> = ({ source, uniforms, maxFps = 60 }) => {
  return (
    <Canvas className="absolute inset-0  h-full w-full">
      <ShaderMaterial source={source} uniforms={uniforms} maxFps={maxFps} />
    </Canvas>
  );
};

/** Brand wordmark for the top-left of the sign-in screen (replaces the demo navbar). */
function Wordmark() {
  return (
    <div className="absolute top-6 left-6 z-20 flex items-center gap-2">
      <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden="true">
          <path
            d="M6.6 10.8a11 11 0 0 0 6.6 6.6l2.2-2.2a.9.9 0 0 1 .92-.22 9 9 0 0 0 2.83.45.9.9 0 0 1 .9.9V19.5a.9.9 0 0 1-.9.9A15.3 15.3 0 0 1 3.6 5.1a.9.9 0 0 1 .9-.9H7.7a.9.9 0 0 1 .9.9c0 .98.15 1.93.45 2.83a.9.9 0 0 1-.22.92L6.6 10.8Z"
            fill="currentColor"
          />
        </svg>
      </div>
      <span className="font-heading text-base font-semibold tracking-tight text-foreground">
        FrontDesk AI
      </span>
    </div>
  );
}

const GoogleIcon = () => (
  <svg className="size-[18px]" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
    />
  </svg>
);

function firstClerkMessage(err: unknown): string | null {
  if (isClerkAPIResponseError(err)) {
    return err.errors[0]?.longMessage ?? err.errors[0]?.message ?? null;
  }
  return null;
}

export const SignInPage = ({ className }: SignInPageProps) => {
  const router = useRouter();
  const signInHook = useSignIn();
  const signUpHook = useSignUp();
  const ready = signInHook.isLoaded && signUpHook.isLoaded;

  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "code" | "success">("email");
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  // Cosmetic sign-in vs sign-up framing (the email flow auto-detects either way).
  const [authView, setAuthView] = useState<"signin" | "signup">("signin");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [emailFactorId, setEmailFactorId] = useState<string | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const codeInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [mounted, setMounted] = useState(false);
  const [initialCanvasVisible, setInitialCanvasVisible] = useState(true);
  const [reverseCanvasVisible, setReverseCanvasVisible] = useState(false);

  // WebGL canvas is client-only — mount-gate it so it never SSRs.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client mount gate
    setMounted(true);
  }, []);

  // Focus first code input when the code screen appears.
  useEffect(() => {
    if (step === "code") {
      setTimeout(() => codeInputRefs.current[0]?.focus(), 500);
    }
  }, [step]);

  // After the success animation, land on the dashboard.
  useEffect(() => {
    if (step === "success") {
      const t = setTimeout(() => router.push(AFTER_AUTH_URL), 1600);
      return () => clearTimeout(t);
    }
  }, [step, router]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!signInHook.isLoaded || !signUpHook.isLoaded || !email || submitting) return;
    const { signIn } = signInHook;
    const { signUp } = signUpHook;
    setSubmitting(true);
    try {
      // Try sign-in for an existing account first.
      const attempt = await signIn.create({ identifier: email });
      const emailFactor = attempt.supportedFirstFactors?.find((f) => f.strategy === "email_code");
      if (!emailFactor || !("emailAddressId" in emailFactor)) {
        setError("Email-code sign-in isn't enabled for this account.");
        return;
      }
      await signIn.prepareFirstFactor({
        strategy: "email_code",
        emailAddressId: emailFactor.emailAddressId,
      });
      setEmailFactorId(emailFactor.emailAddressId);
      setMode("signIn");
      setStep("code");
    } catch (err) {
      // New email → fall back to sign-up.
      if (isClerkAPIResponseError(err) && err.errors[0]?.code === "form_identifier_not_found") {
        try {
          await signUp.create({ emailAddress: email });
          await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
          setMode("signUp");
          setStep("code");
        } catch (signUpErr) {
          setError(firstClerkMessage(signUpErr) ?? "Couldn't start sign-up. Please try again.");
        }
      } else {
        setError(firstClerkMessage(err) ?? "Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const verifyCode = async (fullCode: string) => {
    if (!signInHook.isLoaded || !signUpHook.isLoaded || submitting) return;
    const { signIn, setActive: setActiveSignIn } = signInHook;
    const { signUp, setActive: setActiveSignUp } = signUpHook;
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "signIn") {
        const result = await signIn.attemptFirstFactor({ strategy: "email_code", code: fullCode });
        if (result.status === "complete") {
          await setActiveSignIn({ session: result.createdSessionId });
          playSuccess();
        } else {
          setError("Additional verification is required.");
        }
      } else {
        // Verify the email (skip if a prior attempt already did, so a retry doesn't
        // re-consume the code), then satisfy any extra fields the Clerk instance
        // requires. This is a passwordless product, so we fill password/name
        // automatically — the user signs in with the email code, never a password.
        let su = signUp;
        if (su.verifications?.emailAddress?.status !== "verified") {
          su = await signUp.attemptEmailAddressVerification({ code: fullCode });
        }
        if (su.status !== "complete") {
          const missing = su.missingFields ?? [];
          const updates: { password?: string; firstName?: string; lastName?: string } = {};
          if (missing.includes("password")) updates.password = `Fd1!-${crypto.randomUUID()}`;
          if (missing.includes("first_name")) {
            const local = email.split("@")[0] || "Account";
            updates.firstName = local.charAt(0).toUpperCase() + local.slice(1);
          }
          if (missing.includes("last_name")) updates.lastName = "Owner";
          if (Object.keys(updates).length > 0) su = await signUp.update(updates);
        }
        if (su.status === "complete") {
          await setActiveSignUp({ session: su.createdSessionId });
          playSuccess();
        } else {
          setError(
            `Almost there — your account still needs: ${(su.missingFields ?? ["more info"]).join(", ")}.`,
          );
        }
      }
    } catch (err) {
      setError(firstClerkMessage(err) ?? "That code didn't work — try again.");
      setCode(["", "", "", "", "", ""]);
      setTimeout(() => codeInputRefs.current[0]?.focus(), 10);
    } finally {
      setSubmitting(false);
    }
  };

  // Reverse the canvas, then reveal the success screen.
  const playSuccess = () => {
    setReverseCanvasVisible(true);
    setTimeout(() => setInitialCanvasVisible(false), 50);
    setTimeout(() => setStep("success"), 2000);
  };

  const handleResend = async () => {
    if (!signInHook.isLoaded || !signUpHook.isLoaded || resendState === "sending") return;
    setError(null);
    setResendState("sending");
    try {
      if (mode === "signUp") {
        await signUpHook.signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      } else if (emailFactorId) {
        await signInHook.signIn.prepareFirstFactor({
          strategy: "email_code",
          emailAddressId: emailFactorId,
        });
      }
      setResendState("sent");
      setTimeout(() => setResendState("idle"), 4000);
    } catch (err) {
      setError(
        firstClerkMessage(err) ?? "Couldn't resend — go back, re-enter your email, and try again.",
      );
      setResendState("idle");
    }
  };

  const handleGoogle = async () => {
    setError(null);
    if (!signInHook.isLoaded || submitting) return;
    const { signIn } = signInHook;
    try {
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: SSO_CALLBACK_URL,
        redirectUrlComplete: AFTER_AUTH_URL,
      });
    } catch (err) {
      setError(firstClerkMessage(err) ?? "Couldn't start Google sign-in.");
    }
  };

  const handleCodeChange = (index: number, value: string) => {
    if (value.length <= 1) {
      const newCode = [...code];
      newCode[index] = value.replace(/\D/g, "");
      setCode(newCode);
      if (value && index < 5) {
        codeInputRefs.current[index + 1]?.focus();
      }
      if (index === 5 && value && newCode.every((d) => d.length === 1)) {
        verifyCode(newCode.join(""));
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      codeInputRefs.current[index - 1]?.focus();
    }
  };

  const handleBackClick = () => {
    setStep("email");
    setCode(["", "", "", "", "", ""]);
    setError(null);
    setReverseCanvasVisible(false);
    setInitialCanvasVisible(true);
  };

  const codeComplete = code.every((d) => d !== "");

  return (
    <div
      className={cn(
        "flex w-[100%] flex-col min-h-screen bg-background text-foreground relative",
        className,
      )}
    >
      <div className="absolute inset-0 z-0">
        {mounted && initialCanvasVisible && (
          <div className="absolute inset-0">
            <CanvasRevealEffect
              animationSpeed={3}
              containerClassName="bg-background"
              colors={[
                [10, 10, 10],
                [80, 80, 80],
              ]}
              dotSize={6}
              reverse={false}
            />
          </div>
        )}

        {mounted && reverseCanvasVisible && (
          <div className="absolute inset-0">
            <CanvasRevealEffect
              animationSpeed={4}
              containerClassName="bg-background"
              colors={[
                [10, 10, 10],
                [80, 80, 80],
              ]}
              dotSize={6}
              reverse={true}
            />
          </div>
        )}

        {/* Vignette + top fade keep the form area clean. These were hardcoded
            white, which in dark mode painted an opaque white wash under
            near-white text — "Welcome back" was invisible to anyone whose OS
            prefers dark, on the second page a prospect ever sees. */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--color-background)_0%,_transparent_100%)]" />
        <div className="absolute top-0 left-0 right-0 h-1/3 bg-gradient-to-b from-background to-transparent" />
      </div>

      <div className="relative z-10 flex flex-col flex-1">
        <Wordmark />

        <div className="flex flex-1 flex-col lg:flex-row">
          <div className="flex-1 flex flex-col justify-center items-center">
            <div className="w-full mt-[120px] max-w-sm">
              <AnimatePresence mode="wait">
                {step === "email" ? (
                  <motion.div
                    key="email-step"
                    initial={{ opacity: 0, x: -100 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -100 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    className="space-y-6 text-center"
                  >
                    <div className="space-y-1">
                      <h1 className="font-heading text-[2.5rem] font-semibold leading-[1.1] tracking-tight text-foreground">
                        {authView === "signup" ? "Get started" : "Welcome back"}
                      </h1>
                      <p className="text-[1.25rem] text-muted-foreground font-light">
                        {authView === "signup"
                          ? "Create your company's account"
                          : "Sign in to FrontDesk AI"}
                      </p>
                    </div>

                    <div className="space-y-4">
                      <button
                        type="button"
                        onClick={handleGoogle}
                        disabled={!ready}
                        className="w-full flex items-center justify-center gap-3 bg-background hover:bg-muted text-foreground border border-border rounded-full py-3 px-4 transition-colors disabled:opacity-50"
                      >
                        <GoogleIcon />
                        <span>{authView === "signup" ? "Continue with Google" : "Sign in with Google"}</span>
                      </button>

                      <div className="flex items-center gap-4">
                        <div className="h-px bg-border flex-1" />
                        <span className="text-muted-foreground text-sm">or</span>
                        <div className="h-px bg-border flex-1" />
                      </div>

                      <form onSubmit={handleEmailSubmit}>
                        <div className="relative">
                          <input
                            type="email"
                            placeholder="you@company.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full bg-black/[0.03] text-foreground border-2 border-neutral-300 shadow-sm rounded-full py-3 px-4 focus:outline-none focus:border-neutral-500 focus:ring-2 focus:ring-ring/20 text-center placeholder:text-neutral-400 transition-colors"
                            required
                          />
                          <button
                            type="submit"
                            disabled={!ready || submitting}
                            className="absolute right-1.5 top-1.5 text-primary-foreground w-9 h-9 flex items-center justify-center rounded-full bg-primary hover:bg-primary/90 transition-colors group overflow-hidden disabled:opacity-50"
                          >
                            <span className="relative w-full h-full block overflow-hidden">
                              <span className="absolute inset-0 flex items-center justify-center transition-transform duration-300 group-hover:translate-x-full">
                                →
                              </span>
                              <span className="absolute inset-0 flex items-center justify-center transition-transform duration-300 -translate-x-full group-hover:translate-x-0">
                                →
                              </span>
                            </span>
                          </button>
                        </div>
                        {/* Clerk Smart CAPTCHA mounts here for the sign-up fallback. */}
                        <div id="clerk-captcha" className="mt-3 flex justify-center empty:hidden" />
                      </form>

                      {error && <p className="text-sm text-destructive">{error}</p>}
                    </div>

                    <p className="text-xs text-neutral-400 pt-6">
                      We&apos;ll email you a 6-digit code — no password needed.
                    </p>
                    {/* The Terms open with "by creating an account you accept
                        these terms" — an assent nobody creating an account
                        through THIS page was ever shown. The arbitration clause
                        is only worth what this line makes it. */}
                    {authView === "signup" ? (
                      <p className="text-xs text-neutral-400">
                        By creating an account you agree to our{" "}
                        <a href="/terms" className="underline underline-offset-2 hover:text-foreground">
                          Terms
                        </a>{" "}
                        and{" "}
                        <a href="/privacy" className="underline underline-offset-2 hover:text-foreground">
                          Privacy Policy
                        </a>
                        .
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setAuthView((v) => (v === "signup" ? "signin" : "signup"))}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {authView === "signup"
                        ? "Already have an account? Sign in"
                        : "New to FrontDesk AI? Create your company's account"}
                    </button>
                  </motion.div>
                ) : step === "code" ? (
                  <motion.div
                    key="code-step"
                    initial={{ opacity: 0, x: 100 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 100 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    className="space-y-6 text-center"
                  >
                    <div className="space-y-1">
                      <h1 className="font-heading text-[2.5rem] font-semibold leading-[1.1] tracking-tight text-foreground">
                        We sent you a code
                      </h1>
                      <p className="text-[1.1rem] text-muted-foreground font-light">
                        Enter it to {mode === "signUp" ? "create your account" : "sign in"}
                      </p>
                    </div>

                    <div className="w-full">
                      <div className="relative rounded-full py-4 px-5 border border-border bg-black/[0.02]">
                        <div className="flex items-center justify-center">
                          {code.map((digit, i) => (
                            <div key={i} className="flex items-center">
                              <div className="relative">
                                <input
                                  ref={(el) => {
                                    codeInputRefs.current[i] = el;
                                  }}
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  maxLength={1}
                                  value={digit}
                                  onChange={(e) => handleCodeChange(i, e.target.value)}
                                  onKeyDown={(e) => handleKeyDown(i, e)}
                                  className="w-8 text-center text-xl bg-transparent text-foreground border-none focus:outline-none focus:ring-0 appearance-none"
                                  style={{ caretColor: "transparent" }}
                                />
                                {!digit && (
                                  <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center pointer-events-none">
                                    <span className="text-xl text-neutral-300">0</span>
                                  </div>
                                )}
                              </div>
                              {i < 5 && <span className="text-neutral-300 text-xl">|</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {error && <p className="text-sm text-destructive">{error}</p>}

                    <div>
                      <motion.button
                        type="button"
                        onClick={handleResend}
                        disabled={resendState === "sending"}
                        className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer text-sm disabled:opacity-60"
                        whileHover={{ scale: 1.02 }}
                        transition={{ duration: 0.2 }}
                      >
                        {resendState === "sending"
                          ? "Sending…"
                          : resendState === "sent"
                            ? "New code sent ✓"
                            : "Resend code"}
                      </motion.button>
                    </div>

                    <div className="flex w-full gap-3">
                      <motion.button
                        onClick={handleBackClick}
                        className="rounded-full border border-border bg-transparent text-foreground font-medium px-8 py-3 hover:bg-muted transition-colors w-[30%]"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        transition={{ duration: 0.2 }}
                      >
                        Back
                      </motion.button>
                      <motion.button
                        onClick={() => codeComplete && verifyCode(code.join(""))}
                        className={cn(
                          "flex-1 rounded-full font-medium py-3 border transition-all duration-300",
                          codeComplete && !submitting
                            ? "bg-primary text-primary-foreground border-transparent hover:bg-primary/90 cursor-pointer"
                            : "bg-muted text-muted-foreground border-border cursor-not-allowed",
                        )}
                        disabled={!codeComplete || submitting}
                      >
                        {submitting ? "Verifying…" : "Continue"}
                      </motion.button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="success-step"
                    initial={{ opacity: 0, y: 50 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: "easeOut", delay: 0.3 }}
                    className="space-y-6 text-center"
                  >
                    <div className="space-y-1">
                      <h1 className="font-heading text-[2.5rem] font-semibold leading-[1.1] tracking-tight text-foreground">
                        You&apos;re in!
                      </h1>
                      <p className="text-[1.1rem] text-muted-foreground font-light">
                        Taking you to your dashboard
                      </p>
                    </div>

                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.5, delay: 0.5 }}
                      className="py-10"
                    >
                      <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-neutral-900 to-neutral-700 flex items-center justify-center">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-8 w-8 text-white"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>
                    </motion.div>

                    <motion.button
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 1 }}
                      onClick={() => router.push(AFTER_AUTH_URL)}
                      className="w-full rounded-full bg-primary text-primary-foreground font-medium py-3 hover:bg-primary/90 transition-colors"
                    >
                      Continue to dashboard
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
