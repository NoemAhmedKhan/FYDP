// Toggle Password Visibility
document.addEventListener('DOMContentLoaded', function() {
    const togglePassword = document.querySelector('.toggle-password');
    const passwordInput = document.querySelector('#password');

    if (togglePassword && passwordInput) {
        togglePassword.addEventListener('click', function() {
            // Toggle the type attribute
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            
            // Toggle the icon
            this.classList.toggle('fa-eye-slash');
            this.classList.toggle('fa-eye');
        });
    }

    // Form Validation
    const loginForm = document.querySelector('.login-form');
    
    if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const email = document.querySelector('#email').value;
            const password = document.querySelector('#password').value;

            if(password == 'user'){
                window.location.href = 'UserDashboard.html';
            }
            else if(password == 'pharmacy'){
                window.location.href = 'PharmDashboard.html';
            }
            // Basic validation
            // if (!email || !password) {
            //     alert('Please fill in all fields');
            //     return;
            // }
            
            // Email validation
            // const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            // if (!emailRegex.test(email)) {
            //     alert('Please enter a valid email address');
            //     return;
            // }
            
            // If validation passes, you can submit the form
            // console.log('Form submitted successfully');
            // alert('Login successful! (This is a demo)');
            
            // Here you would typically send the data to your backend
            // fetch('/api/login', { method: 'POST', body: JSON.stringify({email, password}) })
        });
    }
});
