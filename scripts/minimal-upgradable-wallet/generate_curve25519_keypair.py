from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import x25519

def generate_curve25519_keypair():
    # Generate a new Curve25519 keypair
    private_key = x25519.X25519PrivateKey.generate()
    public_key = private_key.public_key()
    
    # Serialize the keys to raw bytes
    private_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption()
    )
    
    public_bytes = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw
    )
    
    return private_bytes, public_bytes

private_key, public_key = generate_curve25519_keypair()

print("Private Key (32 bytes):")
print("0x" + private_key.hex())

print("\nPublic Key (32 bytes):")
print("0x" + public_key.hex())
