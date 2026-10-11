"""One local sandbox client CA/key pair; no cloud, system trust or database access."""
import datetime as dt
import base64
import hashlib
import json
import os
import pathlib
import secrets
import subprocess
import sys

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

def main():
    if len(sys.argv) != 2 or os.name != "nt":
        raise ValueError("Require one fresh Windows private material directory")
    base = pathlib.Path("F:/ChatGPT_workshop").resolve(strict=True)
    target = pathlib.Path(sys.argv[1]).absolute()
    if target.parent.resolve(strict=True) != base or not target.name.startswith("techlong-f3c2-materials-") or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in target.name):
        raise ValueError("Private workspace boundary rejected")
    target.mkdir()  # Never overwrite/reuse an old generation.
    # Restrict the directory before a private key is written. chmod alone is not
    # an adequate Windows ACL. Administrators can still take ownership.
    command = ("$ErrorActionPreference='Stop';Import-Module ([IO.Path]::Combine($PSHOME,'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1'));$p='" + str(target) + "';$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;"
               "$a=Get-Acl -LiteralPath $p;$a.SetAccessRuleProtection($true,$false);"
               "$r=[Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow');"
               "$a.SetAccessRule($r);Set-Acl -LiteralPath $p -AclObject $a;"
               "$v=Get-Acl -LiteralPath $p;if(!$v.AreAccessRulesProtected){throw 'ACL not protected'};"
               "foreach($rule in $v.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){"
               "if($rule.IdentityReference.Value -ne $sid.Value -or $rule.AccessControlType -ne 'Allow'){throw 'Unexpected ACL'}};")
    encoded = base64.b64encode(command.encode("utf-16-le")).decode("ascii")
    try:
        subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)
    except subprocess.CalledProcessError as error:
        # This is strictly before key generation; the ACL diagnostic contains
        # only the already-public output path, not private material.
        print("WINDOWS_ACL_PRE_KEY_FAILURE: " + error.stderr.decode("utf-8", errors="replace")[:3000], file=sys.stderr)
        raise
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    client_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Techlong Sandbox Control CA v1")])
    client_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Techlong Sandbox Worker v1")])
    ca = (x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name).public_key(ca_key.public_key())
          .serial_number(x509.random_serial_number()).not_valid_before(now - dt.timedelta(minutes=5))
          .not_valid_after(now + dt.timedelta(days=365))
          .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
          .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), critical=True)
          .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
          .sign(ca_key, hashes.SHA256()))
    client = (x509.CertificateBuilder().subject_name(client_name).issuer_name(ca_name).public_key(client_key.public_key())
              .serial_number(x509.random_serial_number()).not_valid_before(now - dt.timedelta(minutes=5))
              .not_valid_after(now + dt.timedelta(days=90))
              .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
              .add_extension(x509.KeyUsage(True, False, True, False, False, False, False, False, False), critical=True)
              .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.CLIENT_AUTH]), critical=False)
              .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
              .sign(ca_key, hashes.SHA256()))
    passphrase = secrets.token_bytes(32)
    files = {
        "ca-bundle.pem": ca.public_bytes(serialization.Encoding.PEM),
        "client-cert.pem": client.public_bytes(serialization.Encoding.PEM),
        "client-key.pem": client_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()),
        "ca-key.encrypted.pem": ca_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.BestAvailableEncryption(passphrase)),
        "ca-key-passphrase.bin": passphrase,
    }
    for name, content in files.items():
        with (target / name).open("xb") as handle:
            handle.write(content)
    report = {"schemaVersion": 1, "purpose": "sandbox-mtls-material/v1", "createdAt": now.isoformat(),
              "caSha256": hashlib.sha256(files["ca-bundle.pem"]).hexdigest(),
              "clientCertificateSha256": hashlib.sha256(files["client-cert.pem"]).hexdigest(),
              "caValidUntil": ca.not_valid_after_utc.isoformat(), "clientValidUntil": client.not_valid_after_utc.isoformat(),
              "rsaBits": 3072, "clientExtendedKeyUsage": "clientAuth", "privateKeysKeptLocal": True,
              "caPassphraseStoredAlongsideUnderOwnerAcl": True, "crlInstalled": False,
              "serverTrustIsSeparatePublicAcmChain": True, "cloudWrites": 0, "runtimeEnabled": False}
    with (target / "material-receipt.json").open("x", encoding="utf-8", newline="\n") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    print(json.dumps({"outcome": "PRIVATE_SANDBOX_MTLS_MATERIAL_PREPARED", "directory": str(target), **report}))

if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("SANDBOX_MTLS_MATERIAL_PREPARATION_FAILED_NO_RESET", file=sys.stderr)
        sys.exit(1)
