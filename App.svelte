<script>
  import { onMount } from "svelte";
  var rezultat;
  var lijevi;
  var desni;
  var ukupnoPokusaja = 0;
  var ukupnoTacnih = 0;
  var ukupnoNetacnih = 0;
  var ukupnoTacnihZaredom = 0;
  let elm;
  let pojas = 0;
  var jos = 1;

  let pojasevi = [
    {
      ime: "bijeli",
      bodova: 1,
    },
    {
      ime: "zuti",
      bodova: 20,
    },
    {
      ime: "zeleni",
      bodova: 40,
    },
    {
      ime: "plavi",
      bodova: 70,
    },
    {
      ime: "crveni",
      bodova: 80,
    },
    {
      ime: "crni",
      bodova: 100,
    },
  ];

  let slikePojaseva = [
    "/pojasevi/bijeli.png",
    "/pojasevi/zuti.png",
    "/pojasevi/zeleni.png",
    "/pojasevi/plavi.png",
    "/pojasevi/crveni.png",
    "/pojasevi/crni.png",
  ];

  const checkPojas = () => {
    console.log("pojas: ", pojasevi[pojas].ime);
    console.log("tacnih zaredom: ", ukupnoTacnihZaredom);
    console.log("bodova za pojas: ", pojasevi[pojas].bodova);
    if (ukupnoTacnihZaredom === pojasevi[pojas].bodova) {
      pojas += 1;
      localStorage.setItem("pojas", pojas);
      ukupnoTacnihZaredom = 0;
      alert("Svaka cast, dobili ste " + pojasevi[pojas].ime + " pojas.");
    }
    jos = pojasevi[pojas].bodova - ukupnoTacnihZaredom;
  };

  const postaviZadatak = () => {
    let cinioci = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    lijevi = cinioci[Math.floor(Math.random() * cinioci.length)];
    desni = cinioci[Math.floor(Math.random() * cinioci.length)];
  };

  onMount(() => {
    postaviZadatak();
    ukupnoPokusaja = parseInt(localStorage.getItem("ukupnoPokusaja")) || 0;
    ukupnoTacnih = parseInt(localStorage.getItem("ukupnoTacnih")) || 0;
    ukupnoNetacnih = parseInt(localStorage.getItem("ukupnoNetacnih")) || 0;
    pojas = parseInt(localStorage.getItem("pojas")) || 0;
    jos = pojasevi[pojas].bodova;
    elm.focus();
  });

  const handleKeyup = () => {
    if (event.code == "Enter") {
      event.preventDefault();
      // event.target.value
      // value = event.target.value
      console.log("enter:", event.target.value);
      return false;
    }
  };

  const calculate = (e) => {
    const rez = e.target.value;
    if (lijevi * desni === rezultat) {
      console.log("tacno");
      ukupnoPokusaja += 1;
      localStorage.setItem("ukupnoPokusaja", ukupnoPokusaja.toString());
      ukupnoTacnih += 1;
      localStorage.setItem("ukupnoTacnih", ukupnoTacnih.toString());
      ukupnoTacnihZaredom += 1;
    } else {
      console.log("netacno");
      ukupnoPokusaja += 1;
      localStorage.setItem("ukupnoPokusaja", ukupnoPokusaja.toString());
      ukupnoNetacnih += 1;
      localStorage.setItem("ukupnoNetacnih", ukupnoNetacnih.toString());
      ukupnoTacnihZaredom = 0;
    }
    checkPojas();
    postaviZadatak();
    rezultat = "";
    elm.focus();
  };

  const tacanRezultat = () => {};
  const netacanRezultat = () => {};
</script>

<style>
  @import url("https://fonts.googleapis.com/css2?family=Bungee+Shade&family=Open+Sans:wght@400;600&display=swap");

  main {
    font-family: "Open Sans", sans-serif;
    font-weight: 600;
    text-align: center;
    background-color: #ffffff;
    border-radius: 20px;
  }

  h1 {
    font-family: "Bungee Shade", cursive;
  }

  .brojevi {
    font-size: xx-large;
    color: #2c2c2c;
  }
  .rezultat {
    font-size: xx-large;
    width: 50px;
    border-color: darkgrey;
    border: solid 1px;
    border-radius: 10px;
    color: #black;
  }
  .dugme {
    background-color: #ff3e2f;
    border-radius: 28px;
    border: 1px solid #18ab29;
    display: inline-block;
    cursor: pointer;
    font-family: Arial;
    font-size: 17px;
    padding: 16px 31px;
    text-decoration: none;
    text-shadow: 0px 1px 0px #2f6627;
    color: #eeeced;
  }

  .racun {
    background-color: #e2e2e2;
    border-radius: 20px;
    padding: 10px;
  }

  .tekst {
    color: #2c2c2c;
  }

  .pojas {
    width: 60%;
  }
</style>

<main>
  <h1>Tablica množenja</h1>
  <div>Imate {pojasevi[pojas].ime} pojas</div>
  <img src={slikePojaseva[pojas]} alt="pojas" class="pojas" />
  <br />
  <div class="racun">
    <div>
      <div class="tekst">Izračunaj:</div>
      <br />
      <div class="brojevi">{lijevi} * {desni}</div>
    </div>
    <br />
    <div class="tekst">Rezultat:</div>
    <input
      type="number"
      class="rezultat"
      bind:value={rezultat}
      bind:this={elm}
      on:keyup|preventDefault={handleKeyup} />
    <br />
    <br />
    <button class="dugme" on:click|preventDefault={calculate}>Izračunaj</button>
  </div>
  <br />
  <div>
    Treba Vam jos
    {jos}
    pogodaka zaredom za
    {pojasevi[pojas + 1].ime}
    pojas
  </div>
  <br />
  <div>ukupno pokusaja: {ukupnoPokusaja}</div>
  <div>ukupno tacnih: {ukupnoTacnih}</div>
  <div>ukupno netacnih: {ukupnoNetacnih}</div>
  <div>ukupno tacnih zaredom: {ukupnoTacnihZaredom}</div>
</main>
