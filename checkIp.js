async function main() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();

        console.log('PUBLIC OUTBOUND IP:', data.ip);
    } catch (error) {
        console.error('Failed to get public IP:', error);
    }
}

main();