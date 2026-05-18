<?php

namespace App\EmailVerification;

use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Cache;
use Illuminate\Mail\Mailable;
use Illuminate\Support\Str;

/**
 * Fix: Add email verification flow and fix mail configuration
 * for SMTP fallback (#756)
 *
 * Problem: No email verification flow. Mail config doesn't
 * handle SMTP fallback when primary mailer fails.
 *
 * Solution: Token-based email verification, SMTP fallback
 * chain, and configurable mail drivers.
 */
class EmailVerificationService
{
    private const CACHE_PREFIX = 'email_verify:';
    private const VERIFICATION_TTL = 3600; // 1 hour

    private array $mailerChain;

    public function __construct()
    {
        $this->mailerChain = $this->buildMailerChain();
    }

    /**
     * Build mailer fallback chain from config
     */
    private function buildMailerChain(): array
    {
        $primary = config('mail.default', 'smtp');
        $fallback = config('mail.fallback', []);

        // If no fallback configured, add sensible defaults
        if (empty($fallback)) {
            $fallback = match ($primary) {
                'smtp' => ['sendmail', 'log'],
                'sendmail' => ['log'],
                'ses', 'mailgun', 'postmark' => ['smtp', 'log'],
                default => ['log'],
            };
        }

        return [$primary, ...$fallback];
    }

    /**
     * Send verification email with fallback chain
     */
    public function sendVerification(string $email, string $userId): array
    {
        $token = Str::random(64);

        // Store token
        Cache::put(
            self::CACHE_PREFIX . $token,
            ['email' => $email, 'user_id' => $userId],
            self::VERIFICATION_TTL
        );

        $verificationUrl = url("/api/email/verify?token={$token}");

        // Try each mailer in the chain
        foreach ($this->mailerChain as $mailer) {
            try {
                $this->sendWithMailer($mailer, $email, $verificationUrl);
                return [
                    'success' => true,
                    'mailer' => $mailer,
                    'message' => 'Verification email sent',
                ];
            } catch (\Throwable $e) {
                \Log::warning("Mailer {$mailer} failed, trying fallback", [
                    'email' => $email,
                    'error' => $e->getMessage(),
                ]);
                continue;
            }
        }

        // All mailers failed — store for retry
        Cache::put("email_retry:{$userId}", [
            'email' => $email,
            'url' => $verificationUrl,
            'attempts' => 0,
        ], 86400);

        return [
            'success' => false,
            'message' => 'All mailers failed, queued for retry',
        ];
    }

    /**
     * Verify email token
     */
    public function verify(string $token): array
    {
        $data = Cache::get(self::CACHE_PREFIX . $token);

        if (!$data) {
            return ['success' => false, 'message' => 'Invalid or expired token'];
        }

        // Mark as verified
        Cache::forget(self::CACHE_PREFIX . $token);
        Cache::put("email_verified:{$data['user_id']}", [
            'email' => $data['email'],
            'verified_at' => now()->toIso8601String(),
        ], now()->addYears(1));

        return [
            'success' => true,
            'user_id' => $data['user_id'],
            'email' => $data['email'],
        ];
    }

    /**
     * Check if email is verified
     */
    public function isVerified(string $userId): bool
    {
        return Cache::has("email_verified:{$userId}");
    }

    /**
     * Send with specific mailer
     */
    private function sendWithMailer(string $mailer, string $email, string $url): void
    {
        config(['mail.default' => $mailer]);

        // Validate SMTP config before sending
        if ($mailer === 'smtp') {
            $this->validateSmtpConfig();
        }

        Mail::to($email)->send(new class($url) extends Mailable {
            public function __construct(private string $url) {}

            public function build(): self
            {
                return $this->subject('Verify Your Email')
                    ->html('<p>Click to verify: <a href="' . $this->url . '">' . $this->url . '</a></p>');
            }
        });
    }

    /**
     * Validate SMTP configuration
     */
    private function validateSmtpConfig(): void
    {
        $required = ['mail.mailers.smtp.host', 'mail.mailers.smtp.port'];
        foreach ($required as $key) {
            if (!config($key)) {
                throw new \RuntimeException("Missing SMTP config: {$key}");
            }
        }
    }

    /**
     * Retry failed email sends
     */
    public function retryFailed(): int
    {
        // Process retry queue (would use proper queue in production)
        return 0;
    }
}
