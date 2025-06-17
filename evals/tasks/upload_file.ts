import { EvalFunction } from "@/types/evals";

export const upload_file: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  stagehand,
}) => {
  try {
    await stagehand.page.goto(
      "https://browser-tests-alpha.vercel.app/api/upload-test",
    );

    const observations = await stagehand.page.observe(
      "Find the element for uploading files",
    );

    const uploadObservation = observations[0];
    uploadObservation.arguments = [
      {
        name: "emoji.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAABmJLR0QA/wD/AP+gvaeTAAAAB3RJTUUH6AcSAyYAv2tNNgAADx9JREFUeNrtnXl4VOW9x7+/c85sGYYsgAkzkxBZL1sxAiJLglFWF1qktvK41AW1XnulthYfK4+2VG1dbi/q5Vorty2PFK30FnmoFMSnIZMAXhkK4hN4aCRsSQhhSbNNMnOWX//AxCJJnEySc2Yy7+evkGEy7/x+3/e3vOe87wEEAoFAIBAIBAKBQCAQJAvU378gMwglw7JUWcuEYchkSKmQWCKmNFDb9+dWBlrAaGHiVptGzYjop2j+mWYhgERx8u7s4bpu5DGQR6ArAc4GkA1gKAB7jH+6nsCVzHQSxFUEKjOIDiit9v00t6JeCMAqh28d6dA8oXywNI8I14IxCeCBJg+jAsB+Yi6SIH1AsyvLhQD60um7/T5DxxJmng/gOgApcTbECgAfgPC+7MraTlP2qUIAPXV6Ua5TV9RbwLgbwAIASoLotQ6MjSzzW7ZZ1aVCAN11fEnOcJ31xwHcCcCT4Dn2UyZeLWekr6fxZREhgC4IF/snysQ/ArA0gWZ7lKrGGQb9SonY/yueCkiKmxkP/SUwFidBa3qeQD+V9MrXqRBaUguAg94UrVlaQcRPAHAm0wIMA0eI6QfK7MqtSSkArdi7CESvA/AimWHeJKvawzSn9kxSCIB3+12aavyCiB6FoI2zAD+oFFS/168FECnxT5OYfw9ghPB5h9Njrdyif9/MJWjTBKAV++8A8dpky/UxOOSgpOtfp8Ka4/1CAPwuZC3T+xwRPSHcGzXnGPRNW0FlcUILgIPeFD2E/wNogfBptwkDfI9SUP1OX36I1GfO357p1kO0RTg/ZhwArddKvPclnAB4x/BU3aXsAHC98GOPkMG0Vi/x91nH1OspgIuGDNBl+18BTBX+6z2zEuNheXbVG3EdATg42abLto3C+b0/UZmwRiv23xq3AmAG6aGaN0TO78N0QLxeLfXOiksBGCW+lQDuFX7qU1xk0HtclJUbVzWAGvDdQMB2ALLwkQn5APhEUmg6zahssTwCcLE3m4B3hPNNrAiBSbrKqy1PAVwERQe9C2CwcIvpYeBBLeC/01IBGLLvSRCuFd6wLBb8N5d6cywRQKTEN4mBlcIJlpKqG/S/zLHXcjEJgIOTbTJjHWLfcCHoPeboJf5lpgrAaD69nIFJwvZxkwpe4EDWEFMEwB9ekclEIvTHF+k6y8+aIgDdZnsRQKqwedx1BcsiAf81fSqASMnQySDcJawdl0gS4eU+FYBkSD9DEmwpT9xSgPPVQPb8PhGAGvDOBGGhsHKchwHwc91pC6MWABH9TJg3AYIAeLJe4l3UqwKI7MyeCkahMG/CVIRP9aoAJMlYIYyaUEyN9r6BrxQAF2deCeAbwqYJFgMM6Ye9IgCNlP9Af9uqnRzVwCLelT2iRwLgrSMdBNH3J2pDoOnG/V8ZKbqc/QH/nQC/ZcXoWyOEvwTt2PE3B06dlaEZhKEZOmZPVLHo2lakDzDiytqGAZSUObB1rx0Vp2U0hCRkphuYNkbFomtbkD3EgvEyzsjurOyuzivqWgAl/gCY880e94GjNjyz3oPKcx0HqFQ3Y8VtTVgwORwXzq88J+GZ9R4cOGrr8HW7Atw3P4T754UgSWaLgJYosyv/1NnLnd7GxSU5w5mNl2Hyyt+ewzYs/1Uq6po6/9iwSij6xIEBLsbEXGsP2ThRK+PBV9JQcbrzMkk3gGC5DbX1EvLHR0BmWpTIueq3De90uwYwoC812/mnL8h44jcehKM4YI0Z+OWf3NhVZrPM+WEV+NHagThbH9203rzHibeLXWaHgIW8258RSxF4u9kGfWGjG82t0cdIZuDn7w6AalEQ+M32FBw93b17YddscaOmztQ8YNdVY3G3BMCBrHHMmGDmKCtOyygts8cUNbbtM//IgVCY8G6JK6aosaHI5ChAdHu3BGBAutlsg27b5wRzjO8Nmn9n2q5DdjSEKMbxOmL+rjFSwKWDPdFHAJDpV/2C5bGvNe0/ajM9Dew9Envtcb5RwrEaU7dR2HXDfn1UAuCPMgYCmGG2AE7Wxm6QsEo48w9z+6uTZ+Uevt/kxVXqeFJfZjU9nDIHFtztG2s4baOuydyNSfU9Hq/J99UwboouBZBhyU0fjh52c04bJ9Z47Wy2if3h0pzxUdQANM8KAQwe2LOl0nSPuUutgzx6D99vugCg6NrCLgUQLvZPBJBjhQDGD4u9istKN3osIDPHKxFjbI75jxPgDuqASwSgSEY+LGLm+NhPUp8+1nxjzhoX+2dOyNXgcbEVZp7Owcm2TgXABk2zSgA3XBXGkNTYZvG38ltMH+9ov4a8EbGJYOl1rVaZ2aU2n57QuQAIlgnArgAP3dj9E1LnTw5jtN+ateDv3dL9q3tjczTccJV1z42Q6dJJ3j58LspNI2AULGTxjHC3jOPN0LHitibLxnvVCBX3zQ1F/f/dTgOr7mqCLLFlY2agYwFosj4NfXhwZLQ8+50GFE76ahFkDzHwxvIGpLnZ0vF+96YQ7r7hq1NQqpvxP480YHiWtZevvyyA9tUIPeB9mkE/RRzADGz+yIlfb025bIUvxcH4xvQwHr65GSkORryw65AdqzeloKLm0hU+RQbm5IXx2OJm0zuVzswr67YMKjz+j0sEoAV8WwDcjDjCMICDx2w4USsjFL446/NGqHA7GfHKkUoF5VUyGlokZKXryBuhxd3ta0w815Zf/eGXBXAcwDAI+j0EPCYXVK1urwE46E3BxcesCpIAJvzbJUWg2owx8VAACkyrBC8VgCR98QtBEgqADWmMsEpSFQGZ/KFvULsAiFhEgCRDs/GYLwQAjBYmSbIgQDT6ixQgOoBkbAWzAUDiolwngEHCJEnXCvo+jwCaH+Lgp2TsBC4KQFPgF9ZIwhTAF/2utP1gNf9/xI71f3WhsYUwY2wE984NwdZPjqVQNeC3O1Kw+7AdHhfjzutbMG1MxNoAQG0CgDGULc4AHx+x43trPDD44jg+Paag7ISC/3ygAUqCP4ZC04HH1w68ZNvbR4cVrHmkEddYK4JBXDbeLhlsfQG4Yaez3fltlJbZ8cx6DwwjcZ1vGMDTb3ku2/NoMGHDTssfoUyobc6QiJBh9UgaWzqOQNuCDrywcYDZ++h6J8Qy8PwfBmD7Pke3vrOpyK0ZEkDpVo+jYELnN1f+sdSJleuiOzMgXgirhKfWebBptzOm72xaepKkDAmA5QK4ozCEmeM6z4fb9jnw0GtpON8Q/xcszzVIeOCV1E5nPgDMHBfBHYUhy8dKOjIkAqVZPRBFBl68v7HL26w/Pabg7pfTsOewLW6dv6vMhrteSkPZic7bl6tHanhpWWOcFLeUTmrAd4iAsfEwnOZWCQ+9NhCHT3bd/83JC+PJbzdZfkPov+bzVze7sWl312ccjPJpeHN5vVWbQjqoAvEwaQHfZwBGxMssqmuS8NivB+LTY12LYJDHwD3zQlgys7XHGzV7kuv/WOrE73a4cKGx6/Q0MVfF6u82Is0dP20NES0nLeA7iTi7GBRWgVW/92BbF3m0jSGpBu6ZG8LXp4fhMmnHbShMeG+PA+t2pOBcFHXJjVPDWLm00TKhdh4BeAVpxb4aEDLjsY1a96ELa/7sjmotwGFj5E+IYMnMMKaO7v2j2NruUH5/rwPbgg6EwhTFDAMeXBjCAwtC5h4NF3UEwErSAr4L8dAJdMbHR+x49m03qs5HXzUNHmhg6mgVU0ermDJahW9QbFu5K89JCJbbsfeIDcFyO841RO9F/2ADK5c2Yuro+O1fGbSKtICvCYA7nlurlghhzRY3/hBwxrQy6HYayLnCwLAhOnKu0OG0Ax6X0b6xJBQmNLZIaAkDp87KOHFWxslaqVtH1rUhScDtBS3491tCpqWkmAVA/AvSAj4VCXIa+MFjNryyOaXTI1mt5uqRGh5d1ISJV2qJYE4w8MuEEkAbB47a8Pr7KQiWx4cQvnalinvntqBgYiSRzAgGVpMW8NUCGIIEZO/fbXhvjxNFn9gRVs2tshw2RuHXIlg8sxVTRqmJaD4Q8DRpAV8RgOuQwDS1Ej7Y58Bfgk58UiFDN/pGDIoMTBquYuGUVsy9OoIBTkZCQ3Qr6QHfjxl4Dv2EUJiw/zMFwXI7guU2HKuR0RKJTRAuO2P4UB1TRkUwZZSKvJFa3Bd23UCVSc4k3jV0mK5Ln6EfPxampk7GyVoZJ2pl1DURWiNAY4vU3sunOBgelwGXA0hzGxh2xcVuISvdQD9mo1JQ9S0CAC3gfROgZRAkC5rBfI19dvV+CQDksPNxMKqEXZIDBl6yz67eD7TtDJpbUQ/iRy6+JujfzqdDim5b1fbv9qUupaB6MxF9X5ioX3u/StG1m6jweOtlAgAAOb/yVQaeF5bql5yXSZ9HhTXH//WXly122wqqniKmJwEYwmb9hs90SZ5NBTWHLlsK6LRJLPEvIOa3AaQJ+yUy9IFM0u2Uf7Kuo1c7vdxly6/cJl88OXS3MGJCEibgabmm8sbOnN9lBGivGxhklPofYOaXAXiEXROCPTL0ZR2F/G4LoF0Ipd4c3cDzAC2FOFAqXqkmxiqpoOpNouhquG4vknMga5wO+ScAvgmxrTxeuEBEL0ou4zWaUt2tDQcxOzCyM3uqJBk/ALAEgE34wBJOEniNFHa+QXMr6mMqEXu8tlCUm2Uo2neY+VEAXuETE+p60D4mflXWqjZQIbSe/a1egreOdOie0Dww3fZ5VEgRrupVTjHzJgZ+17aO3zti6gO4KDdNlyJLING3wSgA4BD+i83pYGxh4g1KfvVuot6/VtPnRRwHvSlaC2bAwC1EdCsgjqTpAoNA+w3Gn1nSt9hmnf5bXzjdVAF8eU0hsjN7vCIb+Uw8C0wFSS4IFUCQQbuIjIAsS7toRuUFc+sJi+GirFxdUmYwIY/AVwHIQ/88tk5n4O8EOkAwDhgkfay4jI+727b1OwF0KIpib7YO5BGkcSxhJJhH4uLzjBKhywgz6CgB5QyUS4RynfigzckHrXZ2wgigU2Fsz3SrA5RRksHZBGmoYcBLZHgBGkqAj4EMAKnomwtYEQD1DNQRUAugkoEaiVHJoBomVCqyfhwzTp+KdhVOCKBPU0tuGtCapipyKhnshvR5W2pAIolSOyhQVCa0P4KMwXU2oiao9no4tHqaUdkCgUAgEAgEAoFAIBAIBAKBQCBISP4J/nZlnK5x3yYAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjQtMDctMThUMDM6Mzc6NTkrMDA6MDD1OnC0AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI0LTA3LTE4VDAzOjM3OjU5KzAwOjAwhGfICAAAAABJRU5ErkJggg==",
          "base64",
        ),
      },
    ];
    uploadObservation.method = "setInputFiles";

    await stagehand.page.act(uploadObservation);

    const actualValue = await stagehand.page
      .locator("xpath=/html/body/span[2]")
      .textContent();
    const expectedValue = "4123";

    await stagehand.close();

    if (actualValue != expectedValue) {
      return {
        _success: false,
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    return {
      _success: true,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } catch (error) {
    logger.error({
      message: `error in upload_file function`,
      level: 0,
      auxiliary: {
        error: {
          value: error.message,
          type: "string",
        },
        trace: {
          value: error.stack,
          type: "string",
        },
      },
    });

    await stagehand.close();

    return {
      _success: false,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } finally {
    await stagehand.close();
  }
};
