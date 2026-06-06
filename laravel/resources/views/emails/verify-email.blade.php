<x-mail::message>
# Verify your email address

Hello {{ $user->name }},

Please confirm your email address to finish setting up your account.

<x-mail::button :url="$verificationUrl">
Verify email address
</x-mail::button>

If you did not create this account, no further action is required.
</x-mail::message>
