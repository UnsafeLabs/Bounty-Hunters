<?php

namespace App\Services;

use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Mail;
use Symfony\Component\Mailer\Exception\TransportException;
use Throwable;

class FallbackMailer
{
    /**
     * Send using primary mailer; on TransportException, retry with fallback_mailer.
     */
    public function send($mailable, $to): void
    {
        try {
            Mail::to($to)->send($mailable);
        } catch (TransportException $e) {
            $fallback = Config::get('mail.fallback_mailer', 'log');
            Mail::mailer($fallback)->to($to)->send($mailable);
        } catch (Throwable $e) {
            if (str_contains(strtolower($e->getMessage()), 'transport') || $e->getPrevious() instanceof TransportException) {
                $fallback = Config::get('mail.fallback_mailer', 'log');
                Mail::mailer($fallback)->to($to)->send($mailable);

                return;
            }
            throw $e;
        }
    }
}
