function toggleAuthMethod() {
    var authMethod = document.getElementById('auth-method').value;
    if (authMethod === 'password') {
      document.getElementById('password-input').style.display = 'block';
      document.getElementById('ssh-input').style.display = 'none';
    } else if (authMethod === 'ssh') {
      document.getElementById('password-input').style.display = 'none';
      document.getElementById('ssh-input').style.display = 'block';
    }
}

function saveForms() {

}