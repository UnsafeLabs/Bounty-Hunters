@component('mail::message')
# Verify your {{ $appName }} email

Use the button below to verify your email address and finish setting up your account.

@component('mail::button', ['url' => $verificationUrl])
Verify email
@endcomponent

If you did not create this account, you can ignore this message.
@endcomponent
