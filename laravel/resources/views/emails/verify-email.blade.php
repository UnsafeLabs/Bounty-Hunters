<x-mail::message>
# Verify your {{ $appName }} account

Thanks for creating an account with {{ $appName }}. Confirm your email address to finish setting up your account.

<x-mail::button :url="$url">
Verify Email Address
</x-mail::button>

If you did not create this account, no further action is required.

Thanks,<br>
{{ config('app.name') }}
</x-mail::message>
