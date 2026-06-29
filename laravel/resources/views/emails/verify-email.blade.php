<x-mail::message>
# Verify your {{ $appName }} email address

Thanks for creating an account. Use the secure link below to verify your email address.

<x-mail::button :url="$verificationUrl">
Verify Email Address
</x-mail::button>

This link expires in {{ $expiresIn }} minutes. If you did not create this account, no action is required.

Thanks,<br>
{{ $appName }}
</x-mail::message>
