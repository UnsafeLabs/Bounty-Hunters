import hmac

def verify_finished(computed_verify, received_verify):
    return hmac.compare_digest(computed_verify, received_verify)
